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
  took: number; timed_out: boolean; terminated_early?: boolean; _shards: CountResult["_shards"];
  hits: { total?: {value: number; relation: "eq" | "gte"}; max_score?: number | null; hits: SearchHit[] };
  aggregations?: Record<string, unknown>;
  [key: string]: unknown;
}
/** Completeness signals accompany the unchanged search response fields. */
export interface SearchResult extends SearchResponse {
  partial: { timedOut: boolean; terminatedEarly: boolean; failedShards: number; totalShards: number; failures: ShardFailure[]; totalLowerBound: boolean };
}
/** GET/multi-get preserve each document's source, versioning metadata and found status. */
export interface DocumentResult {
  _index: string; _id: string; found?: boolean; _source?: unknown;
  _version?: number; _seq_no?: number; _primary_term?: number;
  error?: ShardFailureReason;
  [key: string]: unknown;
}

export function safeShardReason(reason: ShardFailureReason): ShardFailureReason {
  const safe = diagnosticCause(Object.assign(new Error(reason.reason ?? ""), { name: reason.type ?? "Error" }));
  return {
    ...(reason.type === undefined ? {} : { type: safe.name }),
    ...(reason.reason === undefined ? {} : { reason: safe.message }),
    ...(reason.caused_by === undefined ? {} : { caused_by: safeShardReason(reason.caused_by) }),
    ...(reason.root_cause === undefined ? {} : { root_cause: reason.root_cause.map(safeShardReason) }),
    ...(reason.suppressed === undefined ? {} : { suppressed: reason.suppressed.map(safeShardReason) }),
  };
}

function safeDiagnostic(error: unknown): unknown {
  if(typeof error === "string") return diagnosticCause(new Error(error)).message;
  if(Array.isArray(error)) return error.map(safeDiagnostic);
  if(error && typeof error === "object") return Object.fromEntries(Object.entries(error).map(([key,value])=>[key,safeDiagnostic(value)]));
  return error;
}

/** OpenSearch broadcast/replication and node headers carry different diagnostic envelopes. */
function safeResponseHeaders(response: Record<string,unknown>): Record<string,unknown> {
  const shards=response._shards as {failures?: Record<string,unknown>[]} | undefined;
  const nodes=response._nodes as {failures?: unknown[]} | undefined;
  return {...response,
    ...(Array.isArray(shards?.failures)?{_shards:{...shards,failures:shards.failures.map(failure=>({...failure,...(failure.reason===undefined?{}:{reason:safeDiagnostic(failure.reason)})}))}}:{}),
    ...(Array.isArray(nodes?.failures)?{_nodes:{...nodes,failures:nodes.failures.map(safeDiagnostic)}}:{}),
  };
}

/** Bulk-by-scroll mixes indexing causes and search reasons in the same failure array. */
function safeOperationResponse(response: Record<string, unknown>): Record<string, unknown> {
  return {...safeResponseHeaders(response),...(Array.isArray(response.failures)?{failures:response.failures.map(failure=>({...failure,
    ...(failure.cause===undefined?{}:{cause:safeDiagnostic(failure.cause)}),
    ...(failure.reason===undefined?{}:{reason:safeDiagnostic(failure.reason)}),
  }))}:{})};
}

function safeTaskResponse(value: Record<string, unknown>): Record<string, unknown> {
  return {...safeResponseHeaders(value),...(value.error===undefined?{}:{error:safeDiagnostic(value.error)}),
    ...(value.response && typeof value.response==="object" && !Array.isArray(value.response)?{response:safeOperationResponse(value.response as Record<string,unknown>)}:{}),
    ...(Array.isArray(value.node_failures)?{node_failures:value.node_failures.map(safeDiagnostic)}:{}),
    ...(Array.isArray(value.task_failures)?{task_failures:value.task_failures.map(failure=>({...failure,reason:safeDiagnostic(failure.reason)}))}:{}),
  };
}

// Reserved mapper metadata, not a blanket underscore-prefix rule for user fields.
const metadataFields = new Set(["_id", "_index", "_source", "_routing", "_ignored", "_field_names", "_version", "_seq_no", "_primary_term", "_size", "_doc_count", "_nested_path", "_tombstone", "_parent_join", "_data_stream_timestamp", "_feature"]);

/** Invocation-owned transport; paths and status semantics belong to OpenSearch. */
export class OpenSearchClient {
  constructor(private readonly connection: { url: string; fetch: typeof fetch; signal: AbortSignal; authorization?: string }) {}

  private async request<T>(path: string, accepted: readonly number[] = [], body?: unknown, queryErrors = false, method = body === undefined ? "GET" : "POST", operationResult = false): Promise<{ status: number; value: T }> {
    const { url, fetch, signal, authorization } = this.connection;
    const response = await fetchWithRedirects(fetch, new URL(path, url), {
      signal, method, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": typeof body === "string" ? "application/x-ndjson" : "application/json" }), ...(authorization ? { authorization } : {}) },
    });
    if (!response.ok && !accepted.includes(response.status)) {
      if ((queryErrors && response.status === 400) || operationResult) {
        const bytes = await readResponseBody(response, { signal });
        let parsed: Record<string,unknown> | undefined;
        try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* Keep an ordinary HTTP error when no native result was supplied. */ }
        // Bulk-by-scroll sends complete failed-operation results with timeout/highest-failure status.
        if(operationResult && typeof parsed?.total==="number" && Array.isArray(parsed.failures)) return {status:response.status,value:parsed as T};
        const error = parsed?.error as ShardFailureReason | undefined;
        const reason = error?.root_cause?.find(cause => ["query_shard_exception", "parse_exception", "parsing_exception"].includes(cause.type ?? "")) ?? error;
        if (queryErrors && response.status===400 && reason && ["query_shard_exception", "parse_exception", "parsing_exception"].includes(reason.type ?? ""))
          throw new CliError("OpenSearch could not parse the query.", {code:"query.invalid", cause:diagnosticCause(new Error(reason.reason ?? "Invalid query."))});
      }
      await response.body?.cancel();
      throw new HttpError(response.status, "OpenSearch rejected the request.");
    }
    if (method === "HEAD") return {status:response.status,value:undefined as T};
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

  async documents(index: string, ids: readonly string[]): Promise<DocumentResult | DocumentResult[]> {
    if (ids.length === 1) {
      const {status,value} = await this.request<DocumentResult>(`${encodeURIComponent(index)}/_doc/${encodeURIComponent(ids[0]!)}`,[404]);
      if (value.found === false) throw new CliError("Document was not found.",{code:"document.notFound",result:value});
      if (status === 404) throw new HttpError(status,"OpenSearch rejected the document request.");
      return value;
    }
    const {value} = await this.request<{docs:DocumentResult[]}>(`${encodeURIComponent(index)}/_mget`,[],{ids});
    return value.docs.map(document=>({...document,...(document.error === undefined ? {} : {error:safeShardReason(document.error)})}));
  }

  async documentExists(index: string,id: string): Promise<boolean> {
    return (await this.request(`${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`,[404],undefined,false,"HEAD")).status === 200;
  }

  async search(index: string | undefined, body: Record<string, unknown>, parameters: Record<string,string> = {}): Promise<SearchResult> {
    const query = new URLSearchParams(parameters);
    const {value} = await this.request<SearchResponse>(`${index === undefined ? "" : encodeURIComponent(index)+"/"}_search${query.size ? "?"+query : ""}`, [], body, true);
    if (typeof value.took !== "number" || typeof value.timed_out !== "boolean" || !Array.isArray(value.hits?.hits) || !Number.isSafeInteger(value._shards?.failed))
      throw new CliError("OpenSearch returned incomplete search metadata.", {code:"opensearch.invalidResponse"});
    const failures = (value._shards.failures ?? []).map(failure => ({...failure, ...(failure.reason === undefined ? {} : {reason:safeShardReason(failure.reason)})}));
    return {...value, _shards:{...value._shards, ...(value._shards.failures === undefined ? {} : {failures})},
      partial:{timedOut:value.timed_out, terminatedEarly:value.terminated_early === true, failedShards:value._shards.failed, totalShards:value._shards.total, failures, totalLowerBound:value.hits.total?.relation === "gte"}} as SearchResult;
  }

  /** Opens a complete snapshot for one selection; the caller owns deletion and keep-alive renewal. */
  async createPit(index: string): Promise<string> {
    let value: { pit_id?: string };
    try {
      ({ value } = await this.request<{pit_id?: string}>(`${encodeURIComponent(index)}/_search/point_in_time?keep_alive=1m&allow_partial_pit_creation=false`, [], undefined, false, "POST"));
    } catch (cause) {
      if (cause instanceof HttpError && [400, 404, 405, 501].includes(cause.status))
        throw new CliError("OpenSearch could not open a point in time for this selection.", { code: "search.pitUnavailable", cause });
      throw cause;
    }
    if (typeof value?.pit_id !== "string" || !value.pit_id)
      throw new CliError("OpenSearch returned no point-in-time ID.", { code: "opensearch.invalidResponse" });
    return value.pit_id;
  }

  /** Deletes only the invocation-owned snapshot and verifies the server acknowledged deletion. */
  async deletePit(id: string): Promise<void> {
    const { value } = await this.request<{ pits?: { pit_id: string; successful: boolean }[] }>("_search/point_in_time", [], { pit_id: [id] }, false, "DELETE");
    if (!value?.pits?.some(pit => pit.pit_id === id && pit.successful === true))
      throw new CliError("Point-in-time cleanup failed.", { code: "search.pitCleanupFailed" });
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

  async validateQuery(index: string, body: Record<string, unknown>, explain: boolean): Promise<Record<string, unknown>> {
    const parameters=new URLSearchParams({explain:"true",...(explain?{rewrite:"true",all_shards:"true"}:{})});
    const {value}=await this.request<Record<string,unknown>>(`${encodeURIComponent(index)}/_validate/query?${parameters}`, [], body);
    return {...safeResponseHeaders(value),...(value.error===undefined?{}:{error:safeDiagnostic(value.error)}),...(Array.isArray(value.explanations)?{explanations:value.explanations.map(explanation=>({...explanation,...(explanation.error===undefined?{}:{error:safeDiagnostic(explanation.error)})}))}:{})};
  }

  async explainQuery(index: string, id: string, body: Record<string,unknown>): Promise<Record<string,unknown>> {
    return (await this.request<Record<string,unknown>>(`${encodeURIComponent(index)}/_explain/${encodeURIComponent(id)}`,[],body,true)).value;
  }

  async analyze(index: string | undefined, body: Record<string,unknown>): Promise<{tokens:Record<string,unknown>[]}> {
    const {status,value}=await this.request<{tokens:Record<string,unknown>[];error?:ShardFailureReason}>(`${index === undefined ? "" : encodeURIComponent(index)+"/"}_analyze`,[400],body);
    if(status===400) throw new CliError("OpenSearch could not analyze the text.",{code:"analysis.invalid",cause:diagnosticCause(new Error(value.error?.reason ?? "Analyzer request was rejected."))});
    return value;
  }

  async nodes(): Promise<NodeSummary[]> {
    const parameters=new URLSearchParams({format:"json",bytes:"b",full_id:"true",h:"id,name,cluster_manager,heap.percent,ram.percent,cpu,load_1m,disk.used,disk.avail,disk.total"});
    const {value:rows}=await this.request<Record<string,string|null>[]>(`_cat/nodes?${parameters}`);
    const {value:info}=await this.request<{nodes:Record<string,{roles:string[]}>}>("_nodes?filter_path=nodes.*.roles");
    const number=(value:unknown):number|null=>value===null || value===undefined || value==="-" ? null : Number.isFinite(Number(value)) && String(value).trim()!=="" ? Number(value) : null;
    return rows.map(row=>({id:row.id!,name:row.name!,roles:info.nodes[row.id!]?.roles ?? [],clusterManager:row.cluster_manager==="*",
      heapPercent:number(row["heap.percent"]),ramPercent:number(row["ram.percent"]),cpuPercent:number(row.cpu),load1m:number(row.load_1m),
      diskUsedBytes:number(row["disk.used"]),diskAvailableBytes:number(row["disk.avail"]),diskTotalBytes:number(row["disk.total"])}));
  }

  async nodeStats(node: string | undefined, metric: string): Promise<Record<string,unknown>> {
    return safeResponseHeaders((await this.request<Record<string,unknown>>(`_nodes/${encodeURIComponent(node ?? "_all")}/stats/${encodeURIComponent(metric)}`)).value);
  }

  async shards(index: string | undefined, state: string | undefined): Promise<ShardSummary[]> {
    const {value}=await this.request<Record<string,string|null>[]>(`_cat/shards${index===undefined?"":"/"+encodeURIComponent(index)}?format=json&h=index,shard,prirep,state,unassigned.reason`);
    return value.filter(row=>state===undefined || row.state?.toLowerCase()===state.toLowerCase()).map(row=>({index:row.index!,shard:catCount(row.shard)!,primary:row.prirep==="p",state:row.state!,unassignedReason:row["unassigned.reason"] ?? null}));
  }

  async allocation(body: Record<string,unknown>): Promise<Record<string,unknown>> {
    const {status,value}=await this.request<Record<string,unknown>&{error?:ShardFailureReason}>("_cluster/allocation/explain",[400],body);
    if(status===400) {
      if(Object.keys(body).length===0 && value.error?.type==="illegal_argument_exception" && value.error.reason?.includes("unable to find any unassigned shards")) return {unassigned:false};
      throw new CliError("OpenSearch could not explain shard allocation.",{code:"allocation.rejected",cause:diagnosticCause(new Error(value.error?.reason ?? "Allocation request was rejected."))});
    }
    return safeDiagnostic(value) as Record<string,unknown>;
  }

  async tasks(actions: string | undefined, detailed: boolean): Promise<TaskList> {
    const query=new URLSearchParams({group_by:"none",detailed:String(detailed),...(actions===undefined?{}:{actions})});
    return safeTaskResponse((await this.request<TaskList>(`_tasks?${query}`)).value) as TaskList;
  }

  async task(id: string, cancel = false): Promise<Record<string,unknown>> {
    const {status,value}=await this.request<Record<string,unknown>&{error?:ShardFailureReason}>(`_tasks/${encodeURIComponent(id)}${cancel?"/_cancel":""}`,[400],undefined,false,cancel?"POST":"GET");
    if(status===400) throw new CliError("OpenSearch could not cancel the task.",{code:"task.cancelRejected",cause:diagnosticCause(new Error(value.error?.reason ?? "Cancellation was rejected."))});
    if(cancel) {
      const failures=[...(Array.isArray(value.node_failures)?value.node_failures:[]),...(Array.isArray(value.task_failures)?value.task_failures:[])];
      if(failures.length) {
        const safe=safeTaskResponse(value);
        throw new CliError("OpenSearch could not cancel the task.",{code:"task.cancelRejected",result:safe,cause:diagnosticCause(new Error(failures.map(f=>typeof f.reason==="string"?f.reason:f.reason?.reason ?? "Cancellation failed.").join("; ")))});
      }
    }
    return safeTaskResponse(value);
  }

  async writeDocument(operation:"index"|"create"|"update"|"delete",index:string,id:string|undefined,body:Record<string,unknown>|undefined,parameters:Record<string,string>):Promise<DocumentResult> {
    const path=`${encodeURIComponent(index)}/${operation==="update"?"_update":operation==="create"?"_create":"_doc"}${id===undefined?"":"/"+encodeURIComponent(id)}`;
    const query=new URLSearchParams(parameters);
    const method=operation==="delete"?"DELETE":operation==="update" || id===undefined?"POST":"PUT";
    const {status,value}=await this.request<DocumentResult&{error?:ShardFailureReason}>(path+(query.size?"?"+query:""),[409],body,false,method);
    if(status===409) throw new CliError("The document conflicts with its current version.",{code:"document.conflict",cause:diagnosticCause(new Error(value.error?.reason ?? "Version conflict."))});
    return safeResponseHeaders(value) as DocumentResult;
  }

  async createIndex(index:string,body:Record<string,unknown>):Promise<Record<string,unknown>> {
    if((await this.request(encodeURIComponent(index),[404],undefined,false,"HEAD")).status===200)
      throw new CliError("The index already exists.",{code:"index.exists"});
    const {status,value}=await this.request<Record<string,unknown>&{error?:ShardFailureReason}>(encodeURIComponent(index),[400],body,false,"PUT");
    if(status===400) {
      if(value.error?.type==="resource_already_exists_exception")throw new CliError("The index already exists.",{code:"index.exists"});
      throw new CliError("OpenSearch could not create the index.",{code:"index.createRejected",cause:diagnosticCause(new Error(value.error?.reason ?? "Index creation was rejected."))});
    }
    return acknowledged(value);
  }

  async deleteIndex(index:string):Promise<Record<string,unknown>> {
    return acknowledged((await this.request<Record<string,unknown>>(encodeURIComponent(index),[],undefined,false,"DELETE")).value);
  }

  async writeByQuery(index:string|undefined,body:Record<string,unknown>,wait:boolean):Promise<Record<string,unknown>> {
    const {status,value:response}=await this.request<Record<string,unknown>>(`${index===undefined?"_reindex":encodeURIComponent(index)+"/_delete_by_query"}?wait_for_completion=${wait}`,[],body,true,"POST",wait);
    const value=safeOperationResponse(response);
    if(!wait) {
      if(typeof value.task!=="string" || !value.task)throw new CliError("OpenSearch returned no task ID.",{code:"opensearch.invalidResponse"});
      return {...value,next:[["tasks","show",value.task]]};
    }
    if(status>=400 || value.timed_out===true || (Array.isArray(value.failures) && value.failures.length>0))
      throw new CliError("The operation completed with incomplete results.",{code:"operation.partial",result:value});
    return value;
  }

  async changeAlias(alias:string,index:string,operation:"add"|"remove"|"swap",destination?:string):Promise<Record<string,unknown>> {
    if(operation==="swap") {
      const {status,value}=await this.request<Record<string,{aliases?:Record<string,unknown>}>>(`_alias/${encodeURIComponent(alias)}`,[404]);
      if(status===404 || !value[index]?.aliases || !Object.hasOwn(value[index]!.aliases!,alias))
        throw new CliError("The alias does not point to the source index.",{code:"alias.sourceMismatch"});
    }
    const actions=operation==="swap"?[{remove:{index,alias,must_exist:true}},{add:{index:destination,alias}}]:operation==="remove"?[{remove:{index,alias,must_exist:true}}]:[{add:{index,alias}}];
    return acknowledged((await this.request<Record<string,unknown>>("_aliases",[],{actions})).value);
  }

  async bulk(index:string|undefined,body:string):Promise<BulkResponse> {
    return (await this.request<BulkResponse>(`${index===undefined?"":encodeURIComponent(index)+"/"}_bulk`,[],body)).value;
  }
}

function acknowledged(value:Record<string,unknown>):Record<string,unknown> {
  if(value.acknowledged!==true) throw new CliError("OpenSearch did not acknowledge the operation; its outcome is uncertain.",{code:"operation.unacknowledged",result:value});
  return value;
}

/** Per-action bulk results correspond to request order, not document-ID uniqueness. */
export interface BulkResponse {took:number;errors:boolean;items:Record<string,{_id?:string;status:number;result?:string;error?:ShardFailureReason}>[]}

/** Numeric CAT observations joined to the full roles reported by node information. */
export interface NodeSummary {id:string;name:string;roles:string[];clusterManager:boolean;heapPercent:number|null;ramPercent:number|null;cpuPercent:number|null;load1m:number|null;diskUsedBytes:number|null;diskAvailableBytes:number|null;diskTotalBytes:number|null}
/** One observed shard allocation, including an unavailable reason when not supplied. */
export interface ShardSummary {index:string;shard:number;primary:boolean;state:string;unassignedReason:string|null}
/** Flat task-list response; task identity consists of node ID and task number. */
export interface TaskList {tasks:{node:string;id:number;action:string;running_time_in_nanos:number;cancellable:boolean}[];[key:string]:unknown}

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
