import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { addAbortSignal } from "node:stream";
import { text } from "node:stream/consumers";
import { CliError, diagnosticCause, jsonParser, type CommandContext } from "@eyeauras/cli-factory";

/** Reads a Query DSL query object; stdin must be fresh and is reserved by RPC sessions. */
export async function readQuery(file: string, context: CommandContext): Promise<Record<string, unknown>> {
  let source: string;
  try {
    if (file === "-") {
      if (context.io.input.readableDidRead) throw new CliError("Use a query file when stdin is already in use.", { code: "usage" });
      source = await text(addAbortSignal(context.signal, context.io.input));
    } else source = await readFile(resolve(context.cwd, file), { encoding: "utf8", signal: context.signal });
  } catch (cause) {
    if (cause instanceof CliError) throw cause;
    throw new CliError("Could not read the query input.", { code: "query.readFailed", cause: diagnosticCause(cause) });
  }
  let query: unknown;
  try { query = jsonParser("Query input must contain valid JSON.")(source); }
  catch (cause) { throw new CliError("Could not parse the query input.", { code: "query.invalid", cause }); }
  if (!query || typeof query !== "object" || Array.isArray(query))
    throw new CliError("Query input must contain a Query DSL query object.", { code: "query.invalid" });
  return query as Record<string, unknown>;
}
