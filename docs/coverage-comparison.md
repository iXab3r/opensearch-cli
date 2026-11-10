# API coverage comparison

How much of the OpenSearch API each tool can call. Measured 2026-11-10.

Two tools share the name `opensearch-cli`. Here **this CLI** is `@eyeauras/opensearch-cli` 0.2.0
(this repository) and the **official CLI** is the OpenSearch project's Go tool, release 1.2.0.

| Tool | Reachable operations (of 490) | Method + path endpoints (of 720) |
|---|---:|---:|
| This CLI 0.2.0, typed commands | 41 (8%) | 48 (7%) |
| Official CLI 1.2.0, typed commands | 3 (1%) | 4 (1%) |
| Official CLI 1.2.0, raw `curl` passthrough | 481 (98%) | 710 (99%) |

This CLI has no raw request command, so it has no passthrough column: everything it reaches,
it reaches through a typed command. The official CLI is the opposite: three typed plugin
commands and a `curl` command that sends any path the caller writes.

## By API area

Percent of operations reachable, with the count in brackets.

| API area | Operations | This CLI 0.2.0, typed | Official CLI 1.2.0, typed | Official CLI 1.2.0, `curl` |
|---|---:|---:|---:|---:|
| Documents and search | 43 | 40% (17) | 2% (1) | 93% (40) |
| Indices, aliases, data streams | 52 | 21% (11) | 0% (0) | 92% (48) |
| Cluster, nodes and tasks | 31 | 26% (8) | 0% (0) | 97% (30) |
| CAT and list tables | 27 | 15% (4) | 0% (0) | 100% (27) |
| Snapshots and remote store | 20 | 0% (0) | 0% (0) | 100% (20) |
| Ingest and search pipelines | 11 | 0% (0) | 0% (0) | 100% (11) |
| Security | 82 | 1% (1) | 0% (0) | 100% (82) |
| Machine learning and vectors | 81 | 0% (0) | 2% (2) | 100% (81) |
| Search relevance and LTR | 49 | 0% (0) | 0% (0) | 100% (49) |
| SQL, PPL and async search | 19 | 0% (0) | 0% (0) | 100% (19) |
| Index lifecycle and replication | 37 | 0% (0) | 0% (0) | 97% (36) |
| Monitoring, workflows, other plugins | 38 | 0% (0) | 0% (0) | 100% (38) |
| **All operations** | **490** | **8% (41)** | **1% (3)** | **98% (481)** |

The same areas counted per method + path endpoint:

| API area | Endpoints | This CLI 0.2.0, typed | Official CLI 1.2.0, typed | Official CLI 1.2.0, `curl` |
|---|---:|---:|---:|---:|
| Documents and search | 97 | 22% (21) | 1% (1) | 97% (94) |
| Indices, aliases, data streams | 107 | 11% (12) | 0% (0) | 95% (102) |
| Cluster, nodes and tasks | 55 | 16% (9) | 0% (0) | 98% (54) |
| CAT and list tables | 41 | 12% (5) | 0% (0) | 100% (41) |
| Snapshots and remote store | 25 | 0% (0) | 0% (0) | 100% (25) |
| Ingest and search pipelines | 16 | 0% (0) | 0% (0) | 100% (16) |
| Security | 88 | 1% (1) | 0% (0) | 100% (88) |
| Machine learning and vectors | 104 | 0% (0) | 3% (3) | 100% (104) |
| Search relevance and LTR | 81 | 0% (0) | 0% (0) | 100% (81) |
| SQL, PPL and async search | 19 | 0% (0) | 0% (0) | 100% (19) |
| Index lifecycle and replication | 44 | 0% (0) | 0% (0) | 98% (43) |
| Monitoring, workflows, other plugins | 43 | 0% (0) | 0% (0) | 100% (43) |
| **All endpoints** | **720** | **7% (48)** | **1% (4)** | **99% (710)** |

## By specification namespace

Reachable operation counts. Every namespace belongs to exactly one area.

| Namespace | API area | Operations | This CLI 0.2.0, typed | Official CLI 1.2.0, typed | Official CLI 1.2.0, `curl` |
|---|---|---:|---:|---:|---:|
| `_core` | Documents and search | 43 | 17 | 1 | 40 |
| `indices` | Indices, aliases, data streams | 49 | 11 | 0 | 45 |
| `dangling_indices` | Indices, aliases, data streams | 3 | 0 | 0 | 3 |
| `cluster` | Cluster, nodes and tasks | 22 | 3 | 0 | 21 |
| `nodes` | Cluster, nodes and tasks | 5 | 2 | 0 | 5 |
| `tasks` | Cluster, nodes and tasks | 4 | 3 | 0 | 4 |
| `cat` | CAT and list tables | 24 | 4 | 0 | 24 |
| `list` | CAT and list tables | 3 | 0 | 0 | 3 |
| `snapshot` | Snapshots and remote store | 11 | 0 | 0 | 11 |
| `sm` | Snapshots and remote store | 8 | 0 | 0 | 8 |
| `remote_store` | Snapshots and remote store | 1 | 0 | 0 | 1 |
| `ingest` | Ingest and search pipelines | 5 | 0 | 0 | 5 |
| `ingestion` | Ingest and search pipelines | 3 | 0 | 0 | 3 |
| `search_pipeline` | Ingest and search pipelines | 3 | 0 | 0 | 3 |
| `security` | Security | 79 | 1 | 0 | 79 |
| `security_analytics` | Security | 3 | 0 | 0 | 3 |
| `ml` | Machine learning and vectors | 74 | 0 | 0 | 74 |
| `knn` | Machine learning and vectors | 6 | 0 | 2 | 6 |
| `neural` | Machine learning and vectors | 1 | 0 | 0 | 1 |
| `ltr` | Search relevance and LTR | 26 | 0 | 0 | 26 |
| `search_relevance` | Search relevance and LTR | 22 | 0 | 0 | 22 |
| `ubi` | Search relevance and LTR | 1 | 0 | 0 | 1 |
| `sql` | SQL, PPL and async search | 6 | 0 | 0 | 6 |
| `ppl` | SQL, PPL and async search | 4 | 0 | 0 | 4 |
| `query` | SQL, PPL and async search | 5 | 0 | 0 | 5 |
| `asynchronous_search` | SQL, PPL and async search | 4 | 0 | 0 | 4 |
| `ism` | Index lifecycle and replication | 12 | 0 | 0 | 11 |
| `rollups` | Index lifecycle and replication | 6 | 0 | 0 | 6 |
| `transforms` | Index lifecycle and replication | 8 | 0 | 0 | 8 |
| `replication` | Index lifecycle and replication | 11 | 0 | 0 | 11 |
| `insights` | Monitoring, workflows, other plugins | 1 | 0 | 0 | 1 |
| `wlm` | Monitoring, workflows, other plugins | 4 | 0 | 0 | 4 |
| `notifications` | Monitoring, workflows, other plugins | 9 | 0 | 0 | 9 |
| `observability` | Monitoring, workflows, other plugins | 7 | 0 | 0 | 7 |
| `flow_framework` | Monitoring, workflows, other plugins | 10 | 0 | 0 | 10 |
| `geospatial` | Monitoring, workflows, other plugins | 7 | 0 | 0 | 7 |

## Method

- **Denominator.** The repository's committed inventory,
  [`tools/api-inventory/inventory.json`](../tools/api-inventory/inventory.json): 490 operations
  in 36 namespaces, generated from the official
  [OpenSearch API specification](https://github.com/opensearch-project/opensearch-api-specification)
  at commit `533e57a2d5fc86d7d61c4617aa19cfb6b4526463` (2026-10-29), pinned in
  [`source.json`](../tools/api-inventory/source.json). It covers the server and the plugins the
  specification describes, for every OpenSearch version it describes.
- **Operation.** One logical operation of the specification (`x-operation-group`, for example
  `search` or `indices.create`), which is the unit the inventory and the issue tracker use. An
  operation usually has several method + path endpoints, such as `GET` and `POST` on `/_search`
  and `/{index}/_search`; the inventory lists 720 of them.
- **Reachable** means a shipped command issues the exact method and path template of at least
  one endpoint of the operation. The endpoint tables count each endpoint on its own. Neither
  measures query parameters, payload fields, server version, installed plugins or the
  permissions of the account.
- **Typed and passthrough are separate.** A typed command names the operation, checks its
  input and shapes the result. A passthrough sends whatever method and path the caller writes,
  so it reaches an operation only in the sense that nothing stops the request. The two are
  never added together in one column.
- **This CLI 0.2.0** was measured by reading every request in `src/client.ts`, the only module
  that calls the service, and following each one back to a command in the `--help` tree: 48
  distinct method + path calls, all 48 present in the inventory. The inventory itself records
  no coverage status, so this column is a reading of the source at this revision, not a
  maintained map. Calls made as a step of another command are counted: `GET /` and
  `GET /_plugins/_security/authinfo` during sign-in and `auth status`, `HEAD /{index}` before
  `indices create`, `GET /_alias/{name}` before `aliases swap`, the hidden-index lookup in
  `indices list`, and the point-in-time calls of `search --all`.
- **Official CLI 1.2.0** is tag `v1.2.0` (commit `6bd2733b4486817ae8d8cef02d73b92281e4ffcb`,
  dated 2023-11-02) of the OpenSearch project's `opensearch-cli` repository. Its Go source was read
  without building or running it. Each request built in its `gateway` packages was followed
  back to a command, normalized and matched to the same inventory.

## Caveats for the official CLI columns

- It is a static reading of one release, not a statement about later ones.
- **Typed commands.** 11 distinct calls are reachable from the `ad` and `knn` commands. 4
  match the inventory and give 3 operations: `knn.stats`, `knn.warmup` and `search`. The 7
  others are the Anomaly Detection detector routes (create, get, update, delete, start, stop,
  search), which the pinned specification does not describe, so they cannot be credited here
  although the commands exist.
- The credited `search` operation is `GET /{index}/_search`, issued inside `ad create` to list
  distinct values of a partition field. The official CLI has no search command of its own.
- `knn stats` with only `--nodes` or only `--stat-names` builds a path with an empty segment,
  which matches no endpoint exactly; those two endpoints are not credited. The operation
  `knn.stats` is credited through the other two forms.
- No request exists in its source that is not wired to a command.
- **`curl` passthrough.** `curl get`, `post`, `put`, `delete` and `patch` accept any path, so
  every operation with an endpoint in one of those five methods is counted: 481 operations and
  710 endpoints. The 9 operations that exist only as `HEAD` are out of reach: `exists`,
  `exists_source`, `ping`, `indices.exists`, `indices.exists_alias`,
  `indices.exists_index_template`, `indices.exists_template`,
  `cluster.exists_component_template` and `ism.exists_policy`. The same passthrough also
  reaches routes outside the inventory.
- Coverage is one axis. The official CLI offers things this CLI does not: a raw request
  command for any path, Anomaly Detection and k-NN plugin commands, AWS IAM request signing,
  client-certificate authentication, shell completion and a single binary without Node.js.
  This CLI offers typed commands with a default-deny permission gate for writes and
  deletions, JSON and JSON-RPC output on every command, and partial-result reporting; see the
  [command reference](reference.md).

<details>
<summary>The 41 operations reachable from this CLI 0.2.0</summary>

- `bulk`: `POST /_bulk`, `POST /{index}/_bulk`
- `count`: `GET /{index}/_count`, `POST /{index}/_count`
- `create`: `PUT /{index}/_create/{id}`
- `create_pit`: `POST /{index}/_search/point_in_time`
- `delete`: `DELETE /{index}/_doc/{id}`
- `delete_by_query`: `POST /{index}/_delete_by_query`
- `delete_pit`: `DELETE /_search/point_in_time`
- `exists`: `HEAD /{index}/_doc/{id}`
- `explain`: `POST /{index}/_explain/{id}`
- `field_caps`: `GET /{index}/_field_caps`
- `get`: `GET /{index}/_doc/{id}`
- `index`: `PUT /{index}/_doc/{id}`, `POST /{index}/_doc`
- `info`: `GET /`
- `mget`: `POST /{index}/_mget`
- `reindex`: `POST /_reindex`
- `search`: `POST /{index}/_search`, `POST /_search`
- `update`: `POST /{index}/_update/{id}`
- `cat.aliases`: `GET /_cat/aliases/{name}`
- `cat.indices`: `GET /_cat/indices/{index}`
- `cat.nodes`: `GET /_cat/nodes`
- `cat.shards`: `GET /_cat/shards`, `GET /_cat/shards/{index}`
- `cluster.allocation_explain`: `POST /_cluster/allocation/explain`
- `cluster.health`: `GET /_cluster/health`, `GET /_cluster/health/{index}`
- `cluster.state`: `GET /_cluster/state/{metric}/{index}`
- `indices.analyze`: `POST /_analyze`, `POST /{index}/_analyze`
- `indices.create`: `PUT /{index}`
- `indices.delete`: `DELETE /{index}`
- `indices.exists`: `HEAD /{index}`
- `indices.get`: `GET /{index}`
- `indices.get_alias`: `GET /_alias/{name}`
- `indices.get_data_stream`: `GET /_data_stream/{name}`
- `indices.get_mapping`: `GET /{index}/_mapping`
- `indices.get_settings`: `GET /{index}/_settings`
- `indices.update_aliases`: `POST /_aliases`
- `indices.validate_query`: `POST /{index}/_validate/query`
- `nodes.info`: `GET /_nodes`
- `nodes.stats`: `GET /_nodes/{node_id}/stats/{metric}`
- `security.authinfo`: `GET /_plugins/_security/authinfo`
- `tasks.cancel`: `POST /_tasks/{task_id}/_cancel`
- `tasks.get`: `GET /_tasks/{task_id}`
- `tasks.list`: `GET /_tasks`

</details>

<details>
<summary>The 3 operations reachable from typed commands of the official CLI 1.2.0</summary>

- `knn.stats`: `GET /_plugins/_knn/stats`, `GET /_plugins/_knn/{node_id}/stats/{stat}`
- `knn.warmup`: `GET /_plugins/_knn/warmup/{index}`
- `search`: `GET /{index}/_search`

</details>

The pictures in the README are generated from [`images/readme-images.json`](images/readme-images.json).
