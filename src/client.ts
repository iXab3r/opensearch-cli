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

/** Invocation-owned transport; paths and status semantics belong to OpenSearch. */
export class OpenSearchClient {
  constructor(private readonly connection: { url: string; fetch: typeof fetch; signal: AbortSignal; authorization?: string }) {}

  private async get<T>(path: string, accepted: readonly number[] = []): Promise<{ status: number; value: T }> {
    const { url, fetch, signal, authorization } = this.connection;
    const response = await fetchWithRedirects(fetch, new URL(path, url), {
      signal, headers: { accept: "application/json", ...(authorization ? { authorization } : {}) },
    });
    if (!response.ok && !accepted.includes(response.status)) {
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
    const { value } = await this.get<ClusterInfo>("");
    if (!value || typeof value.cluster_name !== "string" || typeof value.cluster_uuid !== "string" || typeof value.version?.number !== "string")
      throw new CliError("OpenSearch returned incomplete cluster metadata.", { code: "opensearch.invalidResponse" });
    return value;
  }

  async identity(): Promise<{ url: string; reachable: true; user?: string; roles?: string[] }> {
    await this.info();
    const base = { url: this.connection.url, reachable: true as const };
    try {
      const { value } = await this.get<{ user_name?: string; roles?: string[] }>("_plugins/_security/authinfo");
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
    const { status, value } = await this.get<ClusterHealth>(path, [408]);
    if (!value || typeof value.status !== "string" || typeof value.timed_out !== "boolean")
      throw new CliError("OpenSearch returned incomplete cluster health.", { code: "opensearch.invalidResponse" });
    if (value.timed_out) throw new CliError("OpenSearch timed out waiting for cluster health.", { code: "opensearch.healthTimeout", result: value });
    if (status === 408) throw new HttpError(status, "OpenSearch rejected the health request.");
    return value;
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
