import { CliError, command, parseServerUrl, recordView, tableView, type CliDefinition } from "@eyeauras/cli-factory";
import { openSearchAuth } from "./auth.js";
import { clientFor, type AliasSummary, type ClusterHealth, type ClusterInfo, type CountResult, type DataStreamSummary, type FieldSummary, type IndexSection, type IndexSummary } from "./client.js";
import { readQuery } from "./query.js";
import { version } from "./version.js";

export function createDefinition(): CliDefinition {
  return {
    name: "opensearch-cli",
    description: "Explore and manage OpenSearch clusters",
    version,
    permissions: { categories: [{ name: "Delete", description: "Delete OpenSearch data", enabledByDefault: false }] },
    profile: {
      defaults: { auth: "basic" },
      fields: [
        { name: "url", flags: "--url <url>", description: "Set the OpenSearch cluster URL", required: true, normalize: value => parseServerUrl(String(value), "OpenSearch URL must be http(s)://host[:port][/context].").href },
        { name: "auth", flags: "--auth <scheme>", description: "Choose basic, bearer or none", normalize: value => {
          if (!["basic", "bearer", "none"].includes(String(value))) throw new CliError("Authentication must be basic, bearer or none.", { code: "usage" });
          return value;
        } },
      ],
    },
    auth: openSearchAuth(),
    commands: [command("cluster", "Inspect the OpenSearch cluster", [
      command("info", "Show cluster version and identity", async (_, context) => {
        const info = await (await clientFor(context)).info();
        if (info.version.distribution !== "opensearch" || !/^[23]\./.test(info.version.number))
          context.io.error.write("Warning: unsupported distribution or version; supported versions are OpenSearch 2.x and 3.x.\n");
        return info;
      }, { permission: "ReadOnly", view: recordView<ClusterInfo>({ fields: [
        { label: "Cluster", value: value => value.cluster_name },
        { label: "UUID", value: value => value.cluster_uuid },
        { label: "Distribution", value: value => value.version.distribution },
        { label: "Version", value: value => value.version.number },
        { label: "Build date", value: value => value.version.build_date },
        { label: "Build hash", value: value => value.version.build_hash },
        { label: "Lucene", value: value => value.version.lucene_version },
      ] }) }),
      command("health", "Show cluster health and shard allocation", async ({ options }, context) =>
        (await clientFor(context)).health(options as { index?: string; level?: string; waitForStatus?: string; timeout?: string }), {
        permission: "ReadOnly",
        options: [
          { flags: "--index <pattern>", description: "Select indices or data streams" },
          { flags: "--level <level>", description: "Choose cluster, indices or shards" },
          { flags: "--wait-for-status <status>", description: "Wait for green, yellow or red" },
          { flags: "--timeout <duration>", description: "Set the OpenSearch wait timeout" },
        ],
        view: recordView<ClusterHealth>({ fields: [
          { label: "Cluster", value: value => value.cluster_name },
          { label: "Status", value: value => value.status },
          { label: "Timed out", value: value => value.timed_out },
          { label: "Nodes", value: value => value.number_of_nodes },
          { label: "Data nodes", value: value => value.number_of_data_nodes },
          { label: "Primary shards", value: value => value.active_primary_shards },
          { label: "Active shards", value: value => value.active_shards },
          { label: "Relocating", value: value => value.relocating_shards },
          { label: "Initializing", value: value => value.initializing_shards },
          { label: "Unassigned", value: value => value.unassigned_shards },
          { label: "Active %", value: value => value.active_shards_percent_as_number },
        ], sections: [{ title: () => "Indices", lines: value => value.indices ? Object.entries(value.indices).map(([name, index]) => `${name}: ${index.status}`) : undefined }] }),
      }),
    ]), command("indices", "Explore OpenSearch indices", [
      command("list [pattern]", "List index health, counts and sizes", async ({ args, options }, context) =>
        (await clientFor(context)).indices({ ...(args.pattern === undefined ? {} : { pattern: String(args.pattern) }), ...options }), {
        permission: "ReadOnly",
        options: [
          { flags: "--health <status>", description: "Select green, yellow or red indices" },
          { flags: "--include-hidden", description: "Include hidden and system indices" },
        ],
        view: tableView<IndexSummary>({ columns: [
          { header: "Name", value: row => row.name },
          { header: "Health", value: row => row.health },
          { header: "Status", value: row => row.status },
          { header: "Primaries", value: row => row.primaries },
          { header: "Replicas", value: row => row.replicas },
          { header: "Docs", value: row => row.docsCount },
          { header: "Store", value: row => row.storeBytes, format: "bytes" },
        ], empty: "No indices found." }),
      }),
      command("show <index>", "Show index settings, mappings and aliases", async ({ args, options }, context) =>
        (await clientFor(context)).index(args.index, options.section as IndexSection | undefined), {
        permission: "ReadOnly", options: [{ flags: "--section <section>", description: "Select settings, mappings or aliases", parse: value => {
          if (!["settings", "mappings", "aliases"].includes(value)) throw new CliError("Section must be settings, mappings or aliases.", { code: "usage" });
          return value;
        } }],
      }),
    ]), command("aliases", "Explore index aliases", [
      command("list [pattern]", "List alias targets and flags", async ({ args }, context) =>
        (await clientFor(context)).aliases(args.pattern === undefined ? undefined : String(args.pattern)), {
        permission: "ReadOnly", view: tableView<AliasSummary>({ columns: [
          { header: "Alias", value: row => row.alias }, { header: "Index", value: row => row.index },
          { header: "Write", value: row => row.writeIndex }, { header: "Filter", value: row => row.hasFilter },
          { header: "Routing", value: row => row.hasRouting },
        ], empty: "No aliases found." }),
      }),
    ]), command("data-streams", "Explore data streams", [
      command("list [pattern]", "List data stream metadata", async ({ args }, context) =>
        (await clientFor(context)).dataStreams(args.pattern === undefined ? undefined : String(args.pattern)), {
        permission: "ReadOnly", view: tableView<DataStreamSummary>({ columns: [
          { header: "Name", value: row => row.name }, { header: "Timestamp", value: row => row.timestampField },
          { header: "Generation", value: row => row.generation }, { header: "Backing indices", value: row => row.backingIndexCount },
          { header: "Health", value: row => row.health },
        ], empty: "No data streams found." }),
      }),
    ]), command("fields", "Explore index fields", [
      command("list <pattern>", "List field types and conflicts", async ({ args, options }, context) =>
        (await clientFor(context)).fields(args.pattern, options), {
        permission: "ReadOnly", options: [
          { flags: "--type <type>", description: "Select fields containing this type" },
          { flags: "--filter <glob>", description: "Match field paths with * and ?" },
          { flags: "--include-meta", description: "Include reserved metadata fields" },
        ], view: tableView<FieldSummary>({ columns: [
          { header: "Field", value: row => row.name }, { header: "Types", value: row => row.types.join(", ") },
          { header: "Conflict", value: row => row.conflict },
          { header: "Indices by type", value: row => Object.entries(row.indicesByType).map(([type, indices]) => `${type}: ${indices.join(", ")}`).join("; ") },
        ], empty: "No fields found." }),
      }),
    ]), command("count <index>", "Count matching documents", async ({ args, options }, context) => {
      if (options.q !== undefined && options.queryFile !== undefined) throw new CliError("Choose --q or --query-file.", { code: "usage" });
      const result = await (await clientFor(context)).count(args.index, {
        ...(options.q === undefined ? {} : { q: String(options.q) }),
        ...(options.queryFile === undefined ? {} : { query: await readQuery(String(options.queryFile), context) }),
      });
      if (result.partial.failedShards) {
        if (options.failOnPartial) throw new CliError("The document count is partial.", { code: "search.partial", result });
        const reasons = result.partial.failures.slice(0, 3).map(failure => failure.reason?.reason).filter(Boolean).join("; ").replace(/[\r\n\t]+/g, " ");
        context.progress(`Warning: ${result.partial.failedShards}/${result.partial.totalShards} shards failed.${reasons ? " " + reasons : ""}`);
      }
      return result;
    }, { permission: "ReadOnly", options: [
      { flags: "--q <query>", description: "Match a Lucene query string" },
      { flags: "--query-file <path>", description: "Read Query DSL from file or -" },
      { flags: "--fail-on-partial", description: "Fail when any shard fails" },
    ], view: recordView<CountResult>({ fields: [
      { label: "Count", value: value => value.count },
      { label: "Partial", value: value => value.partial.failedShards > 0 },
    ] }) })],
  };
}
