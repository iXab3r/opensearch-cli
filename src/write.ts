import {
  CliError,
  command,
  formatHuman,
  integerParser,
  recordView,
  type CommandDefinition,
  type OptionDefinition,
} from "@eyeauras/cli-factory";
import { clientFor, type DocumentResult } from "./client.js";
import { readQuery } from "./query.js";

const bodyOption = {
  flags: "--body-file <path>",
  description: "Read a JSON body from file or -",
  required: true,
};
const integer = (min: number, message: string) =>
  integerParser({
    min,
    max: Number.MAX_SAFE_INTEGER,
    signed: false,
    errorMessage: message,
  });
const concurrencyOptions: OptionDefinition[] = [
  {
    flags: "--if-seq-no <number>",
    description: "Require a matching sequence number",
    parse: integer(0, "Sequence number must be a nonnegative integer."),
  },
  {
    flags: "--if-primary-term <number>",
    description: "Require a matching primary term",
    parse: integer(1, "Primary term must be a positive integer."),
  },
  {
    flags: "--refresh <refresh>",
    description: "Choose false, true or wait_for",
    parse: (value) => {
      if (!["false", "true", "wait_for"].includes(value))
        throw new CliError("Refresh must be false, true or wait_for.", {
          code: "usage",
        });
      return value;
    },
  },
];
const documentView = recordView<DocumentResult>({
  fields: [
    { label: "Index", value: (v) => v._index },
    { label: "ID", value: (v) => v._id },
    {
      label: "Result",
      value: (v) => (typeof v.result === "string" ? v.result : undefined),
    },
    { label: "Version", value: (v) => v._version },
    { label: "Sequence", value: (v) => v._seq_no },
    { label: "Primary term", value: (v) => v._primary_term },
  ],
});

/** Document writes keep OpenSearch bodies and concurrency metadata unchanged. */
export function documentWriteCommands(): CommandDefinition[] {
  return [
    command(
      "index <index> [id]",
      "Index or replace a document",
      async ({ args, options }, context) => {
        if (options.create && args.id === undefined)
          throw new CliError("Set an ID with --create.", { code: "usage" });
        return (await clientFor(context)).writeDocument(
          options.create ? "create" : "index",
          String(args.index),
          args.id as string | undefined,
          await readQuery(String(options.bodyFile), context),
          writeParameters(options),
        );
      },
      {
        permission: "Update",
        options: [
          bodyOption,
          ...concurrencyOptions,
          { flags: "--create", description: "Create only if the ID is absent" },
        ],
        view: documentView,
      },
    ),
    command(
      "update <index> <id>",
      "Apply an OpenSearch document update",
      async ({ args, options }, context) =>
        (await clientFor(context)).writeDocument(
          "update",
          args.index,
          args.id,
          await readQuery(String(options.bodyFile), context),
          writeParameters(options),
        ),
      {
        permission: "Update",
        options: [bodyOption, ...concurrencyOptions],
        view: documentView,
      },
    ),
    command(
      "delete <index> <id>",
      "Delete a document by ID",
      async ({ args, options }, context) =>
        (await clientFor(context)).writeDocument(
          "delete",
          args.index,
          args.id,
          undefined,
          writeParameters(options),
        ),
      { permission: "Delete", options: concurrencyOptions, view: documentView },
    ),
    command(
      "delete-by-query <index>",
      "Delete documents matching a query",
      async ({ args, options }, context) =>
        (await clientFor(context)).writeByQuery(
          args.index,
          { query: { query_string: { query: options.q } } },
          options.wait !== false,
        ),
      {
        permission: "Delete",
        options: [
          {
            flags: "--q <query>",
            description: "Match a Lucene query string",
            required: true,
          },
          ...waitOptions,
        ],
        view: operationView,
      },
    ),
  ];
}

function writeParameters(
  options: Record<string, unknown>,
): Record<string, string> {
  if ((options.ifSeqNo === undefined) !== (options.ifPrimaryTerm === undefined))
    throw new CliError("Set --if-seq-no and --if-primary-term together.", {
      code: "usage",
    });
  return Object.fromEntries(
    [
      ["if_seq_no", options.ifSeqNo],
      ["if_primary_term", options.ifPrimaryTerm],
      ["refresh", options.refresh],
    ]
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [String(k), String(v)]),
  );
}

const waitOptions: OptionDefinition[] = [
  {
    flags: "--wait",
    description: "Wait for final operation counts",
    defaultValue: true,
  },
  { flags: "--no-wait", description: "Return the background task ID" },
];
const operationView = recordView<Record<string, unknown>>({
  fields: [
    "task",
    "total",
    "created",
    "updated",
    "deleted",
    "version_conflicts",
    "timed_out",
  ].map((key) => ({
    label: key.replaceAll("_", " "),
    value: (v: Record<string, unknown>) =>
      typeof v[key] === "number" ||
      typeof v[key] === "boolean" ||
      typeof v[key] === "string"
        ? (v[key] as number | boolean | string)
        : undefined,
  })),
  sections: [
    {
      title: () => "Failures",
      lines: (v) =>
        Array.isArray(v.failures) ? v.failures.map(formatHuman) : undefined,
    },
  ],
  next: (v) => (Array.isArray(v.next) ? (v.next as string[][]) : []),
});

/** Index creation/deletion use separate Update and Delete safety categories. */
export function indexWriteCommands(): CommandDefinition[] {
  return [
    command(
      "create <index>",
      "Create an index with settings and mappings",
      async ({ args, options }, context) => {
        const body =
          options.bodyFile === undefined
            ? {}
            : await readQuery(String(options.bodyFile), context);
        if (options.shards !== undefined || options.replicas !== undefined)
          body.settings = {
            ...(body.settings as Record<string, unknown> | undefined),
            ...(options.shards === undefined
              ? {}
              : { number_of_shards: options.shards }),
            ...(options.replicas === undefined
              ? {}
              : { number_of_replicas: options.replicas }),
          };
        return (await clientFor(context)).createIndex(args.index, body);
      },
      {
        permission: "Update",
        options: [
          { ...bodyOption, required: false },
          {
            flags: "--shards <number>",
            description: "Set the primary shard count",
            parse: integer(1, "Shards must be a positive integer."),
          },
          {
            flags: "--replicas <number>",
            description: "Set the replica count",
            parse: integer(0, "Replicas must be a nonnegative integer."),
          },
        ],
      },
    ),
    command(
      "delete <index>",
      "Delete an index and its documents",
      async ({ args, options }, context) => {
        if (
          !options.allowWildcards &&
          (/[?*]/.test(args.index) || args.index.split(",").includes("_all"))
        )
          throw new CliError(
            "Use --allow-wildcards to delete an index pattern.",
            { code: "usage" },
          );
        return (await clientFor(context)).deleteIndex(args.index);
      },
      {
        permission: "Delete",
        options: [
          {
            flags: "--allow-wildcards",
            description: "Allow index patterns and _all",
          },
        ],
      },
    ),
  ];
}

/** Alias mutations preserve the source precondition inside one server-side transaction. */
export function aliasWriteCommands(): CommandDefinition[] {
  return [
    command(
      "swap <alias>",
      "Move an alias between indices atomically",
      async ({ args, options }, context) =>
        (await clientFor(context)).changeAlias(
          args.alias,
          String(options.from),
          "swap",
          String(options.to),
        ),
      {
        permission: "Update",
        options: [
          {
            flags: "--from <index>",
            description: "Select the current target index",
            required: true,
          },
          {
            flags: "--to <index>",
            description: "Select the new target index",
            required: true,
          },
        ],
      },
    ),
    command(
      "add <alias> <index>",
      "Add an alias target",
      async ({ args }, context) =>
        (await clientFor(context)).changeAlias(args.alias, args.index, "add"),
      { permission: "Update" },
    ),
    command(
      "remove <alias> <index>",
      "Remove an alias target",
      async ({ args }, context) =>
        (await clientFor(context)).changeAlias(
          args.alias,
          args.index,
          "remove",
        ),
      { permission: "Update" },
    ),
  ];
}

export function reindexCommand(): CommandDefinition {
  return command(
    "reindex",
    "Copy documents into another index",
    async ({ options }, context) =>
      (await clientFor(context)).writeByQuery(
        undefined,
        {
          source: {
            index: options.source,
            ...(options.q === undefined
              ? {}
              : { query: { query_string: { query: options.q } } }),
          },
          dest: { index: options.dest },
        },
        options.wait !== false,
      ),
    {
      permission: "Update",
      options: [
        {
          flags: "--source <index>",
          description: "Select the source index",
          required: true,
        },
        {
          flags: "--dest <index>",
          description: "Select the destination index",
          required: true,
        },
        { flags: "--q <query>", description: "Match a Lucene query string" },
        ...waitOptions,
      ],
      view: operationView,
    },
  );
}
