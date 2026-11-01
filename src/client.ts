import { CliError, HttpError, diagnosticCause, fetchWithRedirects, readResponseBody, type CommandContext } from "@eyeauras/cli-factory";

/** Wire metadata returned by the OpenSearch cluster information API. */
export interface ClusterInfo {
  name: string;
  cluster_name: string;
  cluster_uuid: string;
  version: { distribution?: string; number: string; build_hash?: string; build_date?: string; lucene_version?: string };
}
/** An observed health state; red health remains a successful read. */
export interface ClusterHealth {
  cluster_name: string;
  status: string;
  timed_out: boolean;
  number_of_nodes: number;
  number_of_data_nodes: number;
  active_primary_shards: number;
  active_shards: number;
  relocating_shards: number;
  initializing_shards: number;
  unassigned_shards: number;
  active_shards_percent_as_number: number;
  indices?: Record<string, { status: string }>;
}

/** Index statistics normalized from CAT cells; unavailable observations remain null. */
export interface IndexSummary {
  name: string;
  health: string | null;
  status: string;
  primaries: number | null;
  replicas: number | null;
  docsCount: number | null;
  /** Total primary and replica store size in bytes, never a human size string. */
  storeBytes: number | null;
}

function catCount(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  throw new CliError("OpenSearch returned an invalid index count or size.", { code: "opensearch.invalidResponse" });
}

/** One alias-to-index relationship; routing and filtering expose presence only. */
export interface AliasSummary { alias: string; index: string; writeIndex: boolean | null; hasFilter: boolean; hasRouting: boolean }
/** A data stream's observed metadata, without document contents. */
export interface DataStreamSummary { name: string; timestampField: string; generation: number; backingIndexCount: number; health: string }
/** Selected index configuration; unavailable server defaults remain null. */
export interface IndexSettings { primaries: number | null; replicas: number | null; refreshInterval: string | null; createdAt: string | null; uuid: string | null }
/** Complete mapping and alias definitions belong to OpenSearch, not a CLI-specific schema. */
export interface IndexInspection { name: string; settings: IndexSettings; aliases: Record<string, unknown>; mappings: Record<string, unknown> }
export type IndexSection = "settings" | "mappings" | "aliases";
/** Field types and their concrete indices; a conflict retains every observed type. */
export interface FieldSummary { name: string; types: string[]; conflict: boolean; indicesByType: Record<string, string[]> }
interface MappingNode { type?: string; properties?: Record<string, MappingNode>; fields?: Record<string, MappingNode> }
/** Count observations retain shard evidence so incomplete counts cannot look exact. */
export interface CountResult {
  count: number;
  _shards: { total: number; successful: number; skipped?: number; failed: number; failures?: ShardFailure[] };
  partial: { failedShards: number; totalShards: number; failures: ShardFailure[] };
}
/** Selected shard identity and redacted diagnostics shared by every result/output path. */
export interface ShardFailure { shard?: number; index?: string; node?: string; reason?: ShardFailureReason }
/** Supported OpenSearch cause structure; diagnostic strings use Core's redaction policy. */
export interface ShardFailureReason { type?: string; reason?: string; caused_by?: ShardFailureReason; root_cause?: ShardFailureReason[]; suppressed?: ShardFailureReason[] }

/** A search hit retains OpenSearch metadata and user-selected document contents unchanged. */
export interface SearchHit { _index: string; _id: string; _score?: number | null; _source?: unknown; sort?: unknown[]; [key: string]: unknown }
/** Search responses retain wire data plus explicit completeness signals for callers. */
interface SearchResponse {
  took: number; timed_out: boolean; _shards: CountResult["_shards"];
  hits: { total?: {value: number; relation: "eq" | "gte"}; max_score?: number | null; hits: SearchHit[] };
  aggregations?: Record<string, unknown>;
  [key: string]: unknown;
}
/** Completeness signals accompany the unchanged search response fields. */
export interface SearchResult extends SearchResponse {
  partial: { timedOut: boolean; failedShards: number; totalShards: number; failures: ShardFailure[]; totalLowerBound: boolean };
}

function safeShardReason(reason: ShardFailureReason): ShardFailureReason {
  const safe = diagnosticCause(Object.assign(new Error(reason.reason ?? ""), { name: reason.type ?? "Error" }));
  return {
    ...(reason.type === undefined ? {} : { type: safe.name }),
    ...(reason.reason === undefined ? {} : { reason: safe.message }),
    ...(reason.caused_by === undefined ? {} : { caused_by: safeShardReason(reason.caused_by) }),
    ...(reason.root_cause === undefined ? {} : { root_cause: reason.root_cause.map(safeShardReason) }),
    ...(reason.suppressed === undefined ? {} : { suppressed: reason.suppressed.map(safeShardReason) }),
  };
}

// Reserved mapper metadata, not a blanket underscore-prefix rule for user fields.
const metadataFields = new Set(["_id", "_index", "_source", "_routing", "_ignored", "_field_names", "_version", "_seq_no", "_primary_term", "_size", "_doc_count", "_nested_path", "_tombstone", "_parent_join", "_data_stream_timestamp", "_feature"]);

/** Invocation-owned transport; paths and status semantics belong to OpenSearch. */
export class OpenSearchClient {
  constructor(private readonly connection: { url: string; fetch: typeof fetch; signal: AbortSignal; authorization?: string }) {}

  private async request<T>(path: string, accepted: readonly number[] = [], body?: unknown, queryErrors = false): Promise<{ status: number; value: T }> {
    const { url, fetch, signal, authorization } = this.connection;
    const response = await fetchWithRedirects(fetch, new URL(path, url), {
      signal, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...(authorization ? { authorization } : {}) },
    });
    if (!response.ok && !accepted.includes(response.status)) {
      if (queryErrors && response.status === 400) {
        const bytes = await readResponseBody(response, { signal });
        let error: ShardFailureReason | undefined;
        try { error = (JSON.parse(new TextDecoder().decode(bytes)) as {error?: ShardFailureReason}).error; } catch { /* Use the status when the server supplied no structured error. */ }
        const reason = error?.root_cause?.find(cause => ["query_shard_exception", "parse_exception", "parsing_exception"].includes(cause.type ?? "")) ?? error;
        if (reason && ["query_shard_exception", "parse_exception", "parsing_exception"].includes(reason.type ?? ""))
          throw new CliError("OpenSearch could not parse the query.", {code:"query.invalid", cause:diagnosticCause(new Error(reason.reason ?? "Invalid query."))});
      }
      await response.body?.cancel();
      throw new HttpError(response.status, "OpenSearch rejected the request.");
    }
    const bytes = await readResponseBody(response, { signal });
    let value: T;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); }
    catch (cause) { throw new CliError("OpenSearch returned an invalid JSON response.", { code: "opensearch.invalidResponse", cause: diagnosticCause(cause, [], "Response JSON could not be decoded.") }); }
    return { status: response.status, value };
  }

  async info(): Promise<ClusterInfo> {
    const { value } = await this.request<ClusterInfo>("");
    if (!value || typeof value.cluster_name !== "string" || typeof value.cluster_uuid !== "string" || typeof value.version?.number !== "string")
      throw new CliError("OpenSearch returned incomplete cluster metadata.", { code: "opensearch.invalidResponse" });
    return value;
  }

  async identity(): Promise<{ url: string; reachable: true; user?: string; roles?: string[] }> {
    await this.info();
    const base = { url: this.connection.url, reachable: true as const };
    try {
      const { value } = await this.request<{ user_name?: string; roles?: string[] }>("_plugins/_security/authinfo");
      return {
        ...base,
        ...(typeof value?.user_name === "string" ? { user: value.user_name } : {}),
        ...(Array.isArray(value?.roles) ? { roles: value.roles } : {}),
      };
    } catch (error) {
      if (error instanceof HttpError && [403, 404].includes(error.status)) return base;
      throw error;
    }
  }

  async health(options: { index?: string; level?: string; waitForStatus?: string; timeout?: string }): Promise<ClusterHealth> {
    const query = new URLSearchParams();
    for (const [key, value] of [["level", options.level], ["wait_for_status", options.waitForStatus], ["timeout", options.timeout]])
      if (value !== undefined) query.set(key!, value);
    const path = "_cluster/health" + (options.index === undefined ? "" : "/" + encodeURIComponent(options.index)) + (query.size ? "?" + query : "");
    const { status, value } = await this.request<ClusterHealth>(path, [408]);
    if (!value || typeof value.status !== "string" || typeof value.timed_out !== "boolean")
      throw new CliError("OpenSearch returned incomplete cluster health.", { code: "opensearch.invalidResponse" });
    if (value.timed_out) throw new CliError("OpenSearch timed out waiting for cluster health.", { code: "opensearch.healthTimeout", result: value });
    if (status === 408) throw new HttpError(status, "OpenSearch rejected the health request.");
    return value;
  }

  async indices(options: { pattern?: string; health?: string; includeHidden?: boolean }): Promise<IndexSummary[]> {
    const pattern = encodeURIComponent(options.pattern ?? "*");
    const query = new URLSearchParams({
      format: "json", bytes: "b", h: "index,health,status,pri,rep,docs.count,store.size",
      expand_wildcards: options.includeHidden ? "all" : "open,closed", allow_no_indices: "true",
    });
    if (options.health !== undefined) query.set("health", options.health);
    const { value } = await this.request<Record<string, unknown>[]>(`_cat/indices/${pattern}?${query}`);
    if (!Array.isArray(value)) throw new CliError("OpenSearch returned an invalid index list.", { code: "opensearch.invalidResponse" });
    let rows = value.map(row => {
      if (!row || typeof row.index !== "string" || typeof row.health !== "string" || typeof row.status !== "string")
        throw new CliError("OpenSearch returned incomplete index metadata.", { code: "opensearch.invalidResponse" });
      return {
        name: row.index, health: row.health || null, status: row.status,
        primaries: catCount(row.pri), replicas: catCount(row.rep), docsCount: catCount(row["docs.count"]), storeBytes: catCount(row["store.size"]),
      };
    });
    if (!options.includeHidden && rows.length) {
      // CAT has no system classification before 3.9. Metadata also handles explicit hidden names.
      const classificationQuery = new URLSearchParams({
        filter_path: "metadata.indices.*.system,metadata.indices.*.settings.index.hidden",
        expand_wildcards: "all", allow_no_indices: "true",
      });
      const { value: classification } = await this.request<{
        metadata?: { indices?: Record<string, { system: boolean; settings?: { index?: { hidden?: string } } }> };
      }>(`_cluster/state/metadata/${pattern}?${classificationQuery}`);
      rows = rows.filter(row => {
        const metadata = classification?.metadata?.indices?.[row.name];
        if (typeof metadata?.system !== "boolean")
          throw new CliError("OpenSearch returned incomplete index classification.", { code: "opensearch.invalidResponse" });
        return !metadata.system && metadata.settings?.index?.hidden !== "true";
      });
    }
    return rows.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }

  async aliases(pattern = "*"): Promise<AliasSummary[]> {
    const query = new URLSearchParams({ format: "json", h: "alias,index,is_write_index,filter,routing.index,routing.search" });
    const { value } = await this.request<Record<string, string>[]>(`_cat/aliases/${encodeURIComponent(pattern)}?${query}`);
    return value.map(row => ({ alias: row.alias!, index: row.index!, writeIndex: row.is_write_index === "-" ? null : row.is_write_index === "true",
      hasFilter: row.filter === "*", hasRouting: row["routing.index"] !== "-" || row["routing.search"] !== "-" }))
      .sort((a, b) => a.alias.localeCompare(b.alias) || a.index.localeCompare(b.index));
  }

  async dataStreams(pattern = "*"): Promise<DataStreamSummary[]> {
    const { status, value } = await this.request<{ error?: { type?: string }; data_streams: {
      name: string; timestamp_field: { name: string }; generation: number; indices: unknown[]; status: string;
    }[] }>(`_data_stream/${encodeURIComponent(pattern)}`, [404]);
    if (status === 404) {
      if (value.error?.type === "resource_not_found_exception") return [];
      throw new HttpError(status, "OpenSearch rejected the data stream request.");
    }
    return value.data_streams.map(stream => ({ name: stream.name, timestampField: stream.timestamp_field.name,
      generation: stream.generation, backingIndexCount: stream.indices.length, health: stream.status.toLowerCase() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async index(index: string, section?: IndexSection): Promise<IndexInspection | IndexSettings | Record<string, unknown>> {
    const path = encodeURIComponent(index) + (section === "settings" ? "/_settings" : section === "mappings" ? "/_mapping" : "");
    let value: Record<string, { settings?: { index?: Record<string, string> }; defaults?: { index?: Record<string, string> }; mappings?: Record<string, unknown>; aliases?: Record<string, unknown> }>;
    try { ({ value } = await this.request<typeof value>(path + (section === "mappings" ? "" : "?flat_settings=false&include_defaults=true"))); }
    catch (cause) {
      if (cause instanceof HttpError && cause.status === 404)
        throw new CliError("The index was not found.", { code: "index.notFound", cause, next: [["indices", "list"]] });
      throw cause;
    }
    const names = Object.keys(value);
    if (names.length !== 1) throw new CliError("Select one concrete index.", { code: "usage", next: [["indices", "list"]] });
    const name = names[0]!;
    const item = value[name]!;
    if (section === "mappings") return item.mappings ?? {};
    if (section === "aliases") return item.aliases ?? {};
    const wire = { ...item.defaults?.index, ...item.settings?.index };
    const settings: IndexSettings = {
      primaries: catCount(wire.number_of_shards ?? null), replicas: catCount(wire.number_of_replicas ?? null),
      refreshInterval: wire.refresh_interval ?? null, uuid: wire.uuid ?? null,
      createdAt: wire.creation_date === undefined ? null : new Date(Number(wire.creation_date)).toISOString(),
    };
    return section === "settings" ? settings : { name, settings, aliases: item.aliases ?? {}, mappings: item.mappings ?? {} };
  }

  async fields(pattern: string, options: { type?: string; filter?: string; includeMeta?: boolean }): Promise<FieldSummary[]> {
    const path = encodeURIComponent(pattern);
    const { value: mappings } = await this.request<Record<string, { mappings: MappingNode }>>(`${path}/_mapping?allow_no_indices=true`);
    const { value: capabilities } = await this.request<{ indices: string[]; fields: Record<string, Record<string, { indices?: string[] }>> }>(`${path}/_field_caps?fields=*&allow_no_indices=true&include_unmapped=true`);
    const grouped = new Map<string, Map<string, Set<string>>>();
    const walk = (properties: Record<string, MappingNode>, prefix: string, index: string): void => {
      for (const [key, node] of Object.entries(properties)) {
        const name = prefix + key;
        const type = node.type ?? "object";
        const types = grouped.get(name) ?? new Map<string, Set<string>>();
        const indices = types.get(type) ?? new Set<string>();
        indices.add(index); types.set(type, indices); grouped.set(name, types);
        if (node.properties) walk(node.properties, name + ".", index);
        if (node.fields) walk(node.fields, name + ".", index);
      }
    };
    for (const [index, mapping] of Object.entries(mappings)) walk(mapping.mappings.properties ?? {}, "", index);
    const declared = new Set(grouped.keys());
    for (const [name, caps] of Object.entries(capabilities.fields)) {
      const mapped = grouped.get(name);
      const types = Object.keys(caps).filter(type => type !== "unmapped");
      const allMapped = mapped ? [...new Set([...mapped.values()].flatMap(indices => [...indices]))] : capabilities.indices;
      const merged = new Map(types.map(type => [type, new Set(caps[type]!.indices ?? (types.length === 1 ? allMapped : [...mapped?.get(type) ?? []]))]));
      // Capabilities discover object parents from indexed children; disabled/empty objects need mapping evidence.
      for (const [type, indices] of mapped ?? []) if (type === "object" || type === "nested") {
        const members = merged.get(type) ?? new Set<string>();
        for (const index of indices) members.add(index);
        merged.set(type, members);
      }
      grouped.set(name, merged);
    }
    const filter = options.filter === undefined ? undefined : new RegExp("^" + options.filter.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    return [...grouped].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .filter(([name, types]) => (options.includeMeta || declared.has(name) || !metadataFields.has(name)) && (!options.type || types.has(options.type)) && (!filter || filter.test(name)))
      .map(([name, groups]) => {
        const types = [...groups.keys()].sort();
        return { name, types, conflict: types.length > 1, indicesByType: Object.fromEntries(types.map(type => [type, [...groups.get(type)!].sort()])) };
      });
  }

  async search(index: string, body: Record<string, unknown>, parameters: Record<string,string> = {}): Promise<SearchResult> {
    const query = new URLSearchParams(parameters);
    const {value} = await this.request<SearchResponse>(`${encodeURIComponent(index)}/_search${query.size ? "?"+query : ""}`, [], body, true);
    if (typeof value.took !== "number" || typeof value.timed_out !== "boolean" || !Array.isArray(value.hits?.hits) || !Number.isSafeInteger(value._shards?.failed))
      throw new CliError("OpenSearch returned incomplete search metadata.", {code:"opensearch.invalidResponse"});
    const failures = (value._shards.failures ?? []).map(failure => ({...failure, ...(failure.reason === undefined ? {} : {reason:safeShardReason(failure.reason)})}));
    return {...value, _shards:{...value._shards, ...(value._shards.failures === undefined ? {} : {failures})},
      partial:{timedOut:value.timed_out, failedShards:value._shards.failed, totalShards:value._shards.total, failures, totalLowerBound:value.hits.total?.relation === "gte"}} as SearchResult;
  }

  async count(index: string, options: { q?: string; query?: Record<string, unknown> }): Promise<CountResult> {
    if (options.q !== undefined && options.query !== undefined)
      throw new CliError("Choose --q or --query-file.", { code: "usage" });
    const query = options.q === undefined ? "" : "?" + new URLSearchParams({ q: options.q });
    const { value } = await this.request<Omit<CountResult, "partial">>(`${encodeURIComponent(index)}/_count${query}`, [], options.query === undefined ? undefined : { query: options.query });
    if (!Number.isSafeInteger(value?.count) || value.count < 0 || !Number.isSafeInteger(value._shards?.total) || !Number.isSafeInteger(value._shards?.failed))
      throw new CliError("OpenSearch returned incomplete count metadata.", { code: "opensearch.invalidResponse" });
    const failures = (value._shards.failures ?? []).map(failure => ({
      ...(failure.shard === undefined ? {} : { shard: failure.shard }),
      ...(failure.index === undefined ? {} : { index: failure.index }),
      ...(failure.node === undefined ? {} : { node: failure.node }),
      ...(failure.reason === undefined ? {} : { reason: safeShardReason(failure.reason) }),
    }));
    const shards = { total: value._shards.total, successful: value._shards.successful, failed: value._shards.failed,
      ...(value._shards.skipped === undefined ? {} : { skipped: value._shards.skipped }),
      ...(value._shards.failures === undefined ? {} : { failures }) };
    return { count: value.count, _shards: shards, partial: { failedShards: shards.failed, totalShards: shards.total, failures } };
  }
}

export async function clientFor(context: CommandContext): Promise<OpenSearchClient> {
  const scheme = context.profile.values.auth;
  let authorization: string | undefined;
  if (scheme !== "none") {
    const credential = await context.secrets.get(scheme === "bearer" ? "token" : "basic");
    if (!credential) throw new CliError("Sign in before querying OpenSearch.", { code: "auth.missing", next: [["auth", "login", "--help"]] });
    if (scheme === "bearer") authorization = "Bearer " + credential;
    else {
      const basic = JSON.parse(credential) as { username: string; password: string };
      authorization = "Basic " + Buffer.from(`${basic.username}:${basic.password}`).toString("base64");
    }
  }
  return new OpenSearchClient({ url: String(context.profile.values.url), fetch: context.fetch, signal: context.signal, ...(authorization ? { authorization } : {}) });
}
