import {
  CliError,
  command,
  formatHuman,
  integerParser,
  recordView,
  tableView,
  type CommandDefinition,
} from "@eyeauras/cli-factory";
import {
  clientFor,
  type NodeSummary,
  type ShardSummary,
  type TaskList,
} from "./client.js";
import { readQuery } from "./query.js";

const scalar = (value: unknown) =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? value
    : undefined;
const bodyOption = {
  flags: "--body-file <path>",
  description: "Read a query body from file or -",
  required: true,
};

// Only native telemetry/TaskInfo metadata is formatted; operation response data stays unchanged.
function observationTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(observationTimes);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === "number" &&
        [
          "timestamp",
          "start_time_in_millis",
          "cancellation_time_millis",
        ].includes(key)
          ? new Date(item).toISOString()
          : observationTimes(item),
      ]),
    );
  return value;
}
const statisticsView = recordView<Record<string, unknown>>({
  fields: [],
  sections: [
    {
      title: () => "Node statistics",
      lines: (value) => [formatHuman(observationTimes(value))],
    },
  ],
});
const taskView = recordView<Record<string, unknown>>({
  fields: [],
  sections: [
    {
      title: () => "Task",
      lines: (value) => [
        formatHuman({
          ...value,
          ...(value.task === undefined
            ? {}
            : { task: observationTimes(value.task) }),
          ...(value.nodes === undefined
            ? {}
            : { nodes: observationTimes(value.nodes) }),
        }),
      ],
    },
  ],
});

/** Read-only diagnostic commands and the separately gated task cancellation action. */
export function diagnoseCommands(): CommandDefinition[] {
  return [
    command("query", "Validate queries and explain matches", [
      command(
        "validate <index>",
        "Validate a query before searching",
        async ({ args, options }, context) =>
          (await clientFor(context)).validateQuery(
            args.index,
            await readQuery(String(options.bodyFile), context),
            options.explain === true,
          ),
        {
          permission: "ReadOnly",
          options: [
            bodyOption,
            {
              flags: "--explain",
              description: "Show rewritten queries per shard",
            },
          ],
          view: recordView<Record<string, unknown>>({
            fields: [
              { label: "Valid", value: (v) => scalar(v.valid) },
              { label: "Error", value: (v) => scalar(v.error) },
              {
                label: "Failed shards",
                value: (v) => {
                  const shards = v._shards as { failed?: number } | undefined;
                  return shards?.failed ? shards.failed : undefined;
                },
              },
            ],
            sections: [
              {
                title: () => "Shard failures",
                lines: (v) => {
                  const shards = v._shards as
                    | { failures?: unknown[] }
                    | undefined;
                  return shards?.failures?.map(formatHuman);
                },
              },
              {
                title: () => "Explanations",
                lines: (v) =>
                  Array.isArray(v.explanations)
                    ? v.explanations.map(formatHuman)
                    : undefined,
              },
            ],
          }),
        },
      ),
      command(
        "explain <index> <id>",
        "Explain whether a document matches",
        async ({ args, options }, context) =>
          (await clientFor(context)).explainQuery(
            args.index,
            args.id,
            await readQuery(String(options.bodyFile), context),
          ),
        {
          permission: "ReadOnly",
          options: [bodyOption],
          view: recordView<Record<string, unknown>>({
            fields: [
              { label: "Index", value: (v) => scalar(v._index) },
              { label: "ID", value: (v) => scalar(v._id) },
              { label: "Matched", value: (v) => scalar(v.matched) },
            ],
            sections: [
              {
                title: () => "Explanation",
                lines: (v) =>
                  v.explanation === undefined
                    ? undefined
                    : [formatHuman(v.explanation)],
              },
            ],
          }),
        },
      ),
    ]),
    command(
      "analyze <text>",
      "Show analyzer tokens and positions",
      async ({ args, options }, context) => {
        if (options.analyzer !== undefined && options.field !== undefined)
          throw new CliError("Choose --analyzer or --field.", {
            code: "usage",
          });
        if (options.field !== undefined && options.index === undefined)
          throw new CliError("Set --index with --field.", { code: "usage" });
        return (await clientFor(context)).analyze(
          options.index as string | undefined,
          {
            text: args.text,
            ...(options.analyzer === undefined
              ? {}
              : { analyzer: options.analyzer }),
            ...(options.field === undefined ? {} : { field: options.field }),
          },
        );
      },
      {
        permission: "ReadOnly",
        options: [
          { flags: "--analyzer <name>", description: "Choose an analyzer" },
          { flags: "--index <index>", description: "Use an index analyzer" },
          {
            flags: "--field <field>",
            description: "Use a mapped field analyzer",
          },
        ],
        view: tableView<
          Record<string, unknown>,
          { tokens: Record<string, unknown>[] }
        >({
          rows: (v) => v.tokens,
          columns: [
            { header: "Token", value: (r) => scalar(r.token) },
            { header: "Position", value: (r) => scalar(r.position) },
            { header: "Start", value: (r) => scalar(r.start_offset) },
            { header: "End", value: (r) => scalar(r.end_offset) },
            { header: "Type", value: (r) => scalar(r.type) },
          ],
          empty: "No tokens.",
        }),
      },
    ),
    command("nodes", "Inspect nodes and resource usage", [
      command(
        "list",
        "List node roles and resource usage",
        async (_, context) => (await clientFor(context)).nodes(),
        {
          permission: "ReadOnly",
          view: tableView<NodeSummary>({
            columns: [
              { header: "Name", value: (r) => r.name },
              { header: "Roles", value: (r) => r.roles.join(", ") },
              { header: "Manager", value: (r) => r.clusterManager },
              { header: "Heap %", value: (r) => r.heapPercent },
              { header: "RAM %", value: (r) => r.ramPercent },
              { header: "CPU %", value: (r) => r.cpuPercent },
              { header: "Load", value: (r) => r.load1m },
              {
                header: "Disk used",
                value: (r) => r.diskUsedBytes,
                format: "bytes",
              },
              {
                header: "Disk free",
                value: (r) => r.diskAvailableBytes,
                format: "bytes",
              },
            ],
            empty: "No nodes found.",
          }),
        },
      ),
      command(
        "stats [node]",
        "Show selected node resource metrics",
        async ({ args, options }, context) =>
          (await clientFor(context)).nodeStats(
            args.node as string | undefined,
            String(options.metric),
          ),
        {
          permission: "ReadOnly",
          options: [
            {
              flags: "--metric <metrics>",
              description: "Select comma-separated node metrics",
              defaultValue: "jvm,fs,os",
            },
          ],
          view: statisticsView,
        },
      ),
    ]),
    command("shards", "Inspect shard allocation", [
      command(
        "list [index]",
        "List shard states and unassigned reasons",
        async ({ args, options }, context) =>
          (await clientFor(context)).shards(
            args.index as string | undefined,
            options.state as string | undefined,
          ),
        {
          permission: "ReadOnly",
          options: [
            { flags: "--state <state>", description: "Filter by shard state" },
          ],
          view: tableView<ShardSummary>({
            columns: [
              { header: "Index", value: (r) => r.index },
              { header: "Shard", value: (r) => r.shard },
              { header: "Primary", value: (r) => r.primary },
              { header: "State", value: (r) => r.state },
              { header: "Reason", value: (r) => r.unassignedReason },
            ],
            empty: "No shards found.",
          }),
        },
      ),
      command(
        "explain",
        "Explain a shard allocation decision",
        async ({ options }, context) => {
          const selected =
            options.index !== undefined ||
            options.shard !== undefined ||
            options.primary !== undefined;
          if (
            selected &&
            (options.index === undefined || options.shard === undefined)
          )
            throw new CliError("Set --index and --shard together.", {
              code: "usage",
            });
          return (await clientFor(context)).allocation(
            selected
              ? {
                  index: options.index,
                  shard: options.shard,
                  primary: options.primary === true,
                }
              : {},
          );
        },
        {
          permission: "ReadOnly",
          options: [
            { flags: "--index <index>", description: "Select a shard's index" },
            {
              flags: "--shard <number>",
              description: "Select a shard number",
              parse: integerParser({
                min: 0,
                max: Number.MAX_SAFE_INTEGER,
                signed: false,
                errorMessage: "Shard must be a nonnegative integer.",
              }),
            },
            { flags: "--primary", description: "Explain the primary shard" },
          ],
          view: recordView<Record<string, unknown>>({
            fields: [
              {
                label: "Allocation",
                value: (v) =>
                  v.unassigned === false ? "No unassigned shards." : undefined,
              },
              { label: "Index", value: (v) => scalar(v.index) },
              { label: "Shard", value: (v) => scalar(v.shard) },
              { label: "Primary", value: (v) => scalar(v.primary) },
              { label: "State", value: (v) => scalar(v.current_state) },
              { label: "Can allocate", value: (v) => scalar(v.can_allocate) },
              { label: "Reason", value: (v) => scalar(v.allocate_explanation) },
            ],
            sections: [
              {
                title: () => "Node decisions",
                lines: (v) =>
                  Array.isArray(v.node_allocation_decisions)
                    ? v.node_allocation_decisions.map(formatHuman)
                    : undefined,
              },
            ],
          }),
        },
      ),
    ]),
    command("tasks", "Inspect and cancel cluster tasks", [
      command(
        "list",
        "List running cluster tasks",
        async ({ options }, context) =>
          (await clientFor(context)).tasks(
            options.actions as string | undefined,
            options.detailed === true,
          ),
        {
          permission: "ReadOnly",
          options: [
            {
              flags: "--actions <pattern>",
              description: "Filter task actions",
            },
            { flags: "--detailed", description: "Include task details" },
          ],
          view: tableView<TaskList["tasks"][number], TaskList>({
            rows: (v) => v.tasks,
            columns: [
              { header: "ID", value: (r) => `${r.node}:${r.id}` },
              { header: "Action", value: (r) => r.action },
              { header: "Node", value: (r) => r.node },
              {
                header: "Running",
                value: (r) => r.running_time_in_nanos / 1e6,
                format: "duration",
              },
              { header: "Cancellable", value: (r) => r.cancellable },
            ],
            empty: "No tasks found.",
          }),
        },
      ),
      command(
        "show <id>",
        "Show task status and result",
        async ({ args }, context) => (await clientFor(context)).task(args.id),
        { permission: "ReadOnly", view: taskView },
      ),
      command(
        "cancel <id>",
        "Request cancellation of a task",
        async ({ args }, context) =>
          (await clientFor(context)).task(args.id, true),
        { permission: "Update", view: taskView },
      ),
    ]),
  ];
}
