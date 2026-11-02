import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CliError,
  command,
  diagnosticCause,
  formatHuman,
  integerParser,
  recordView,
  type CommandContext,
  type CommandDefinition,
  type CommandInput,
} from "@eyeauras/cli-factory";
import { clientFor, safeShardReason, type BulkResponse } from "./client.js";

interface Action {
  line: number;
  wire: string;
  deletes: boolean;
}
interface PreparedBulk {
  index: string | undefined;
  actions: Action[];
  batchSize: number;
}
/** Totals cover every submitted action; failures retain the original input line. */
interface BulkReport {
  succeeded: number;
  failed: number;
  took: number;
  unconfirmedCount?: number;
  remainingCount?: number;
  failures: { line: number; _id?: string; status: number; reason: string }[];
}

function object(line: string, lineNumber: number): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new CliError(`Invalid JSON at line ${lineNumber}.`, {
      code: "bulk.invalidInput",
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CliError(`Expected a JSON object at line ${lineNumber}.`, {
      code: "bulk.invalidInput",
    });
  return value as Record<string, unknown>;
}

async function prepare(
  input: CommandInput,
  context: Pick<CommandContext, "cwd" | "signal">,
  load: boolean,
): Promise<PreparedBulk> {
  let source: string;
  try {
    source = await readFile(resolve(context.cwd, String(input.options.file)), {
      encoding: "utf8",
      signal: context.signal,
    });
  } catch (cause) {
    throw new CliError("Could not read the bulk input.", {
      code: "bulk.readFailed",
      cause: diagnosticCause(cause),
    });
  }
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const actions: Action[] = [];
  for (let i = 0; i < lines.length; i++) {
    context.signal.throwIfAborted();
    const line = i + 1;
    const value = object(lines[i]!, line);
    if (load) {
      const id =
        input.options.idField === undefined
          ? undefined
          : value[String(input.options.idField)];
      if (
        input.options.idField !== undefined &&
        typeof id !== "string" &&
        typeof id !== "number"
      )
        throw new CliError(`The ID field is missing at line ${line}.`, {
          code: "bulk.invalidInput",
        });
      actions.push({
        line,
        deletes: false,
        wire:
          JSON.stringify({
            index: id === undefined ? {} : { _id: String(id) },
          }) +
          "\n" +
          lines[i] +
          "\n",
      });
    } else {
      const [operation] = Object.keys(value);
      const metadata = operation === undefined ? undefined : value[operation];
      if (
        Object.keys(value).length !== 1 ||
        !["index", "create", "update", "delete"].includes(operation!) ||
        !metadata ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      )
        throw new CliError(`Invalid bulk action at line ${line}.`, {
          code: "bulk.invalidInput",
        });
      const deletes = operation === "delete";
      let wire = lines[i] + "\n";
      if (!deletes) {
        i++;
        if (i >= lines.length)
          throw new CliError(`Missing document after line ${line}.`, {
            code: "bulk.invalidInput",
          });
        object(lines[i]!, i + 1);
        wire += lines[i] + "\n";
      }
      actions.push({ line, deletes, wire });
    }
  }
  return {
    index: load ? String(input.args.index) : undefined,
    actions,
    batchSize: load
      ? Number(input.options.batchSize)
      : Math.max(actions.length, 1),
  };
}

/** Complete input preparation precedes authentication and the conditional Delete gate. */
export function bulkCommand(): CommandDefinition {
  const prepared = new WeakMap<CommandInput, PreparedBulk>();
  const leaf = (load: boolean) => {
    const settings = {
      permission: "Update",
      options: [
        {
          flags: "--file <path>",
          description: "Read NDJSON from a file",
          required: true,
        },
        ...(load
          ? [
              {
                flags: "--id-field <field>",
                description: "Use a field as document ID",
              },
              {
                flags: "--batch-size <number>",
                description: "Set documents per bulk request",
                defaultValue: 1000,
                parse: integerParser({
                  min: 1,
                  max: Number.MAX_SAFE_INTEGER,
                  signed: false,
                  errorMessage: "Batch size must be a positive integer.",
                }),
              },
            ]
          : []),
      ],
      additionalPermissions: async (
        input: CommandInput,
        context: Pick<CommandContext, "cwd" | "signal">,
      ) => {
        const snapshot = await prepare(input, context, load);
        prepared.set(input, snapshot);
        return snapshot.actions.some((a) => a.deletes) ? ["Delete"] : [];
      },
      view: recordView<BulkReport>({
        fields: [
          { label: "Succeeded", value: (v) => v.succeeded },
          { label: "Failed", value: (v) => v.failed },
          { label: "Unconfirmed", value: (v) => v.unconfirmedCount },
          { label: "Remaining", value: (v) => v.remainingCount },
          { label: "Took (ms)", value: (v) => v.took },
        ],
        sections: [
          {
            title: () => "Failures",
            lines: (v) => v.failures.map(formatHuman),
          },
        ],
      }),
    };
    return command(
      load ? "load <index>" : "run",
      load ? "Load documents from NDJSON" : "Apply an NDJSON bulk action file",
      async (input, context) => {
        const snapshot = prepared.get(input);
        if (!snapshot)
          throw new CliError("Bulk input was not prepared.", {
            code: "bulk.notPrepared",
          });
        prepared.delete(input);
        const client = await clientFor(context);
        const report: BulkReport = {
          succeeded: 0,
          failed: 0,
          took: 0,
          failures: [],
        };
        for (
          let offset = 0;
          offset < snapshot.actions.length;
          offset += snapshot.batchSize
        ) {
          const batch = snapshot.actions.slice(
            offset,
            offset + snapshot.batchSize,
          );
          let response: BulkResponse;
          try {
            response = await client.bulk(
              snapshot.index,
              batch.map((a) => a.wire).join(""),
            );
          } catch (cause) {
            throw new CliError(
              "Bulk submission failed before item results were received.",
              {
                code: "bulk.requestFailed",
                cause,
                result: {
                  ...report,
                  unconfirmedCount: batch.length,
                  remainingCount:
                    snapshot.actions.length - offset - batch.length,
                },
              },
            );
          }
          if (
            !Array.isArray(response.items) ||
            response.items.length !== batch.length ||
            !Number.isFinite(response.took)
          )
            throw new CliError("OpenSearch returned incomplete bulk results.", {
              code: "opensearch.invalidResponse",
              result: report,
            });
          report.took += response.took;
          response.items.forEach((entry, index) => {
            const [operation, item] = Object.entries(entry)[0]!;
            const missingDelete =
              operation === "delete" &&
              item.status === 404 &&
              item.result === "not_found";
            if (item.error || (item.status >= 300 && !missingDelete)) {
              report.failed++;
              report.failures.push({
                line: batch[index]!.line,
                ...(item._id === undefined ? {} : { _id: item._id }),
                status: item.status,
                reason: item.error
                  ? (safeShardReason(item.error).reason ??
                    "Bulk action failed.")
                  : "Bulk action failed.",
              });
            } else report.succeeded++;
          });
        }
        if (report.failed)
          throw new CliError("Some bulk actions failed.", {
            code: "bulk.partial",
            result: report,
          });
        return report;
      },
      settings,
    );
  };
  return command("bulk", "Load documents and apply bulk actions", [
    leaf(true),
    leaf(false),
  ]);
}
