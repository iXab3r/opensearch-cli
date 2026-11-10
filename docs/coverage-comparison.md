# API coverage comparison

How much of the OpenSearch API each tool can call. Measured 2026-11-10.

Two tools share the name `opensearch-cli`. Here **this CLI** is `@eyeauras/opensearch-cli` 0.2.0
(this repository) and the **official CLI** is the OpenSearch project's Go tool, release 1.2.0.

| Tool | Reachable operations (of 490) | Method + path endpoints (of 720) |
|---|---:|---:|
| This CLI 0.2.0, typed commands | 41 (8%) | 48 (7%) |
| curator-opensearch 0.0.13 | 37 (8%) | 44 (6%) |
| elasticdump 6.125.1 | 33 (7%) | 44 (6%) |
| Official CLI 1.2.0, typed commands | 3 (1%) | 4 (1%) |
| Official CLI 1.2.0, raw `curl` passthrough | 481 (98%) | 710 (99%) |

This CLI has no raw request command, so it has no passthrough column: everything it reaches,
it reaches through a typed command. The official CLI is the opposite: three typed plugin
commands and a `curl` command that sends any path the caller writes. curator-opensearch and
elasticdump have no raw request command either. They are special-purpose tools, index and
snapshot housekeeping and data import and export, so the totals are close to this CLI's while
the operations behind them differ; the tables below show where.

## Tools considered

Every command-line tool for OpenSearch found on 2026-11-10 by searching npm, PyPI, crates.io,
Homebrew and GitHub. Stars and downloads are as read on that day.

| Tool | Published | Latest version | Popularity | In the comparison |
|---|---|---|---|---|
| [elasticdump](https://github.com/elasticsearch-dump/elasticsearch-dump) | npm, GitHub | 6.125.1, 2026-05-12 | 7,945 stars; 31,479 npm downloads a week | Measured |
| [OpenSearch Benchmark](https://github.com/opensearch-project/opensearch-benchmark) | PyPI, GitHub | 2.5.0, 2026-10-27 | 151 stars; 10,861 PyPI downloads a month | No: a load-testing framework; the requests it sends come from workload files, not from its commands |
| [curator-opensearch](https://github.com/flant/curator-opensearch) | PyPI, GitHub | 0.0.13, 2024-07-30 | 84 stars; 3,632 PyPI downloads a month | Measured |
| [opensearch-py-ml](https://github.com/opensearch-project/opensearch-py-ml) | PyPI, GitHub | 1.3.0, 2025-09-16 | 55 stars; 59,942 PyPI downloads a month | No: a Python library; its bundled `opensearch-ml` setup command is a small part of it and the signals count the library |
| [Official `opensearch-cli`](https://github.com/opensearch-project/opensearch-cli) | GitHub releases | 1.2.0, 2023-11-02 | 51 stars | Measured |
| [scaledsearch](https://github.com/saidbouig/scaledsearch) | npm, GitHub | 1.2.0, 2026-06-18 | 18 stars; 15 npm downloads a week | No: qualifies, outside the top three (schema migrations) |
| [os-cli](https://github.com/andreafspeziale/os-cli) | npm, GitHub | 1.10.3, 2026-03-06 | 11 stars; 12 npm downloads a week | No: qualifies, outside the top three |
| [OpenSearch SQL CLI](https://github.com/opensearch-project/sql-cli) (`opensearchsql`) | PyPI, GitHub | 1.0.0, 2022-01-25 | 9 stars; 67 PyPI downloads a month | No: outside the top three; an interactive SQL and PPL shell for two query endpoints |
| [OPTIC](https://github.com/oracle/optic) (`opensearch-optic`) | PyPI, GitHub | 2.0.0 on PyPI, 2025-09-22 | 9 stars; 9 PyPI downloads a month | No: qualifies, outside the top three |
| [reporting-cli](https://github.com/opensearch-project/reporting-cli) | npm, GitHub | 1.1.0, 2024-03-22 | 6 stars; 81 npm downloads a week | No: downloads OpenSearch Dashboards reports, does not call the OpenSearch REST API |
| [searchctl](https://github.com/chronicblondiee/searchctl) | GitHub source only | no release or tag | 4 stars | No: nothing published at a pinned version |
| [clibana](https://github.com/ivoronin/clibana) | GitHub releases | 2026.02.05, 2026-02-05 | 3 stars | No: qualifies, outside the top three (log search and tailing) |
| [elastically](https://github.com/denysvitali/elastically) | GitHub source only | no release or tag | 3 stars | No: nothing published at a pinned version |
| [es-tui](https://github.com/davidbudnick/es-tui), [stoptail](https://github.com/dsablic/stoptail) | GitHub releases | 0.0.4, 2026-11-06; 1.10.0, 2026-10-07 | 3 and 2 stars | No: interactive terminal UIs, not command-line clients |
| [osearch](https://github.com/scoopex/osearch) | GitHub releases | 0.0.4, 2026-08-02 | 2 stars | No: qualifies, outside the top three (log search and tailing) |
| [opensearchtools](https://github.com/disaster37/opensearchtools) | GitHub releases | 3.4.6, 2026-11-05 | 1 star | No: qualifies, outside the top three |
| [dalet-oss/opensearch-cli](https://github.com/dalet-oss/opensearch-cli) | GitHub releases | 0.9.5, 2026-03-05 | 1 star | No: qualifies, outside the top three |
| [canonical/opensearch-client](https://github.com/canonical/opensearch-client) | GitHub tag | 0.1.1 | 1 star | No: a library with a small command, outside the top three |
| [osc](https://github.com/KrisBuytaert/osc) | GitHub source only | no release or tag | 1 star | No: nothing published at a pinned version |
| [osapi](https://github.com/logmanager-oss/opensearch-api) | GitHub releases, Go module | 1.3.0, 2026-10-23 | 0 stars | No: a raw request tool ("a resilient `curl` for OpenSearch"), which is not coverage |
| `opensearchcli` | PyPI | 0.2.7, 2026-08-17 | 49 PyPI downloads a month | No: qualifies, outside the top three |
| [osearch-cli](https://github.com/EnzoDeg40/opensearch-cli) | PyPI, GitHub | 0.1.1, 2026-04-01 | 0 stars; 9 PyPI downloads a month | No: qualifies, outside the top three |
| [Elasticsearch Curator](https://github.com/elastic/curator) | PyPI, GitHub | 9.0.0, 2025-10-03 | 3,075 stars | No: targets Elasticsearch only; curator-opensearch is its OpenSearch fork |

Selection rule: a tool is measured when it is a command-line client that explicitly targets the
OpenSearch REST API (not a library, MCP server, editor plugin, benchmark or raw request
wrapper) and is published at a version that can be pinned; when more than three such tools
exist, the three with the most GitHub stars are measured, whatever they score.

## By API area

Percent of operations reachable, with the count in brackets.

| API area | Operations | This CLI 0.2.0, typed | curator-opensearch 0.0.13 | elasticdump 6.125.1 | Official CLI 1.2.0, typed | Official CLI 1.2.0, `curl` |
|---|---:|---:|---:|---:|---:|---:|
| Documents and search | 43 | 40% (17) | 7% (3) | 21% (9) | 2% (1) | 93% (40) |
| Indices, aliases, data streams | 52 | 21% (11) | 35% (18) | 33% (17) | 0% (0) | 92% (48) |
| Cluster, nodes and tasks | 31 | 26% (8) | 23% (7) | 13% (4) | 0% (0) | 97% (30) |
| CAT and list tables | 27 | 15% (4) | 0% (0) | 0% (0) | 0% (0) | 100% (27) |
| Snapshots and remote store | 20 | 0% (0) | 45% (9) | 0% (0) | 0% (0) | 100% (20) |
| Ingest and search pipelines | 11 | 0% (0) | 0% (0) | 0% (0) | 0% (0) | 100% (11) |
| Security | 82 | 1% (1) | 0% (0) | 0% (0) | 0% (0) | 100% (82) |
| Machine learning and vectors | 81 | 0% (0) | 0% (0) | 0% (0) | 2% (2) | 100% (81) |
| Search relevance and LTR | 49 | 0% (0) | 0% (0) | 0% (0) | 0% (0) | 100% (49) |
| SQL, PPL and async search | 19 | 0% (0) | 0% (0) | 0% (0) | 0% (0) | 100% (19) |
| Index lifecycle and replication | 37 | 0% (0) | 0% (0) | 8% (3) | 0% (0) | 97% (36) |
| Monitoring, workflows, other plugins | 38 | 0% (0) | 0% (0) | 0% (0) | 0% (0) | 100% (38) |
| **All operations** | **490** | **8% (41)** | **8% (37)** | **7% (33)** | **1% (3)** | **98% (481)** |

The same areas counted per method + path endpoint:

| API area | Endpoints | This CLI 0.2.0, typed | curator-opensearch 0.0.13 | elasticdump 6.125.1 | Official CLI 1.2.0, typed | Official CLI 1.2.0, `curl` |
|---|---:|---:|---:|---:|---:|---:|
| Documents and search | 97 | 22% (21) | 3% (3) | 16% (16) | 1% (1) | 97% (94) |
| Indices, aliases, data streams | 107 | 11% (12) | 21% (23) | 20% (21) | 0% (0) | 95% (102) |
| Cluster, nodes and tasks | 55 | 16% (9) | 16% (9) | 7% (4) | 0% (0) | 98% (54) |
| CAT and list tables | 41 | 12% (5) | 0% (0) | 0% (0) | 0% (0) | 100% (41) |
| Snapshots and remote store | 25 | 0% (0) | 36% (9) | 0% (0) | 0% (0) | 100% (25) |
| Ingest and search pipelines | 16 | 0% (0) | 0% (0) | 0% (0) | 0% (0) | 100% (16) |
| Security | 88 | 1% (1) | 0% (0) | 0% (0) | 0% (0) | 100% (88) |
| Machine learning and vectors | 104 | 0% (0) | 0% (0) | 0% (0) | 3% (3) | 100% (104) |
| Search relevance and LTR | 81 | 0% (0) | 0% (0) | 0% (0) | 0% (0) | 100% (81) |
| SQL, PPL and async search | 19 | 0% (0) | 0% (0) | 0% (0) | 0% (0) | 100% (19) |
| Index lifecycle and replication | 44 | 0% (0) | 0% (0) | 7% (3) | 0% (0) | 98% (43) |
| Monitoring, workflows, other plugins | 43 | 0% (0) | 0% (0) | 0% (0) | 0% (0) | 100% (43) |
| **All endpoints** | **720** | **7% (48)** | **6% (44)** | **6% (44)** | **1% (4)** | **99% (710)** |

## By specification namespace

Reachable operation counts. Every namespace belongs to exactly one area.

| Namespace | API area | Operations | This CLI 0.2.0, typed | curator-opensearch 0.0.13 | elasticdump 6.125.1 | Official CLI 1.2.0, typed | Official CLI 1.2.0, `curl` |
|---|---|---:|---:|---:|---:|---:|---:|
| `_core` | Documents and search | 43 | 17 | 3 | 9 | 1 | 40 |
| `indices` | Indices, aliases, data streams | 49 | 11 | 18 | 17 | 0 | 45 |
| `dangling_indices` | Indices, aliases, data streams | 3 | 0 | 0 | 0 | 0 | 3 |
| `cluster` | Cluster, nodes and tasks | 22 | 3 | 3 | 4 | 0 | 21 |
| `nodes` | Cluster, nodes and tasks | 5 | 2 | 2 | 0 | 0 | 5 |
| `tasks` | Cluster, nodes and tasks | 4 | 3 | 2 | 0 | 0 | 4 |
| `cat` | CAT and list tables | 24 | 4 | 0 | 0 | 0 | 24 |
| `list` | CAT and list tables | 3 | 0 | 0 | 0 | 0 | 3 |
| `snapshot` | Snapshots and remote store | 11 | 0 | 9 | 0 | 0 | 11 |
| `sm` | Snapshots and remote store | 8 | 0 | 0 | 0 | 0 | 8 |
| `remote_store` | Snapshots and remote store | 1 | 0 | 0 | 0 | 0 | 1 |
| `ingest` | Ingest and search pipelines | 5 | 0 | 0 | 0 | 0 | 5 |
| `ingestion` | Ingest and search pipelines | 3 | 0 | 0 | 0 | 0 | 3 |
| `search_pipeline` | Ingest and search pipelines | 3 | 0 | 0 | 0 | 0 | 3 |
| `security` | Security | 79 | 1 | 0 | 0 | 0 | 79 |
| `security_analytics` | Security | 3 | 0 | 0 | 0 | 0 | 3 |
| `ml` | Machine learning and vectors | 74 | 0 | 0 | 0 | 0 | 74 |
| `knn` | Machine learning and vectors | 6 | 0 | 0 | 0 | 2 | 6 |
| `neural` | Machine learning and vectors | 1 | 0 | 0 | 0 | 0 | 1 |
| `ltr` | Search relevance and LTR | 26 | 0 | 0 | 0 | 0 | 26 |
| `search_relevance` | Search relevance and LTR | 22 | 0 | 0 | 0 | 0 | 22 |
| `ubi` | Search relevance and LTR | 1 | 0 | 0 | 0 | 0 | 1 |
| `sql` | SQL, PPL and async search | 6 | 0 | 0 | 0 | 0 | 6 |
| `ppl` | SQL, PPL and async search | 4 | 0 | 0 | 0 | 0 | 4 |
| `query` | SQL, PPL and async search | 5 | 0 | 0 | 0 | 0 | 5 |
| `asynchronous_search` | SQL, PPL and async search | 4 | 0 | 0 | 0 | 0 | 4 |
| `ism` | Index lifecycle and replication | 12 | 0 | 0 | 3 | 0 | 11 |
| `rollups` | Index lifecycle and replication | 6 | 0 | 0 | 0 | 0 | 6 |
| `transforms` | Index lifecycle and replication | 8 | 0 | 0 | 0 | 0 | 8 |
| `replication` | Index lifecycle and replication | 11 | 0 | 0 | 0 | 0 | 11 |
| `insights` | Monitoring, workflows, other plugins | 1 | 0 | 0 | 0 | 0 | 1 |
| `wlm` | Monitoring, workflows, other plugins | 4 | 0 | 0 | 0 | 0 | 4 |
| `notifications` | Monitoring, workflows, other plugins | 9 | 0 | 0 | 0 | 0 | 9 |
| `observability` | Monitoring, workflows, other plugins | 7 | 0 | 0 | 0 | 0 | 7 |
| `flow_framework` | Monitoring, workflows, other plugins | 10 | 0 | 0 | 0 | 0 | 10 |
| `geospatial` | Monitoring, workflows, other plugins | 7 | 0 | 0 | 0 | 0 | 7 |

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
- **curator-opensearch 0.0.13** is the source distribution on PyPI (uploaded 2024-07-30,
  SHA-256 `c97f45a038e19c71227f0d88baa370d737f2b3a18fe1416d448c21c3a1bf2714`), read without
  installing or running it. It calls the service only through the `opensearch-py` client, so
  each client call reachable from the `curator`, `curator_cli` and `es_repo_mgr` commands was
  turned into the method and path that `opensearch-py` 2.0.0, the lowest version the package
  allows, builds for the arguments passed, then matched to the same inventory. Calls made as
  a step of another action, such as index filters and wait loops, are counted, as they are for
  this CLI.
- **elasticdump 6.125.1** is the npm tarball (published 2026-05-12, SHA-1
  `a08e7cbaf2d0d11f2bf6cbf778916109ebd0fd9f`), read without installing or running it. Every
  request built in `lib/transports/__es__` and in `bin/multielasticdump` was followed back to a
  `--type` or option of the `elasticdump` and `multielasticdump` commands and matched to the
  same inventory, both for a cluster URL and for a URL that names an index. A trailing slash
  is treated as the same route.
- **Official CLI 1.2.0** is tag `v1.2.0` (commit `6bd2733b4486817ae8d8cef02d73b92281e4ffcb`,
  dated 2023-11-02) of the OpenSearch project's `opensearch-cli` repository. Its Go source was read
  without building or running it. Each request built in its `gateway` packages was followed
  back to a command, normalized and matched to the same inventory.

## Caveats for the curator-opensearch column

- It is a static reading of one release, not a statement about later ones. PyPI shows no
  release after 0.0.13 of 2024-07-30.
- 47 distinct calls are reachable from its commands. 44 match the inventory and give 37
  operations.
- The 3 that do not match: `POST /{index}/_flush/synced`, sent by the `close` action unless
  `skip_flush` is set, which the pinned specification does not describe; and the `freeze` and
  `unfreeze` actions, which call `client.xpack`, an attribute `opensearch-py` does not have,
  so they send nothing.
- The paths depend on the `opensearch-py` version installed next to it. The package allows any
  version from 2.0.0; the reading uses 2.0.0. Version 3.2.0 no longer has `flush_synced` and
  takes keyword arguments only, which several calls in this release do not use.
- Many credited operations are steps inside an action, not commands of their own. `search` is
  the `POST /{index}/_search` aggregation of the `field_stats` age filter, and the `nodes`,
  `tasks`, `indices.stats`, `indices.segments` and `indices.recovery` calls serve filters,
  the `shrink` action and wait loops. It has no command to search or read documents.
- Two helper functions (`single_data_path` and `get_snapshot` in `curator/utils.py`) are not
  wired to a command; the requests they would send are also sent elsewhere and are counted
  there.
- Coverage is one axis. curator-opensearch offers things this CLI does not: snapshot,
  restore and repository management, rollover, shrink, force merge, open and close,
  allocation and replica changes, selection of indices and snapshots by age, size, pattern
  or count, YAML action files for scheduled runs, a dry-run mode and AWS request signing.
  This CLI offers document and search commands, cluster diagnostics, a default-deny
  permission gate, and JSON and JSON-RPC output on every command.

## Caveats for the elasticdump column

- It is a static reading of one release, not a statement about later ones.
- 57 distinct calls are reachable from its commands. 44 match the inventory and give 33
  operations.
- The 13 that do not match: 7 belong to its Elasticsearch branch (`/_pit` and `/_ilm/policy`
  routes, which it does not send to OpenSearch); 2 are point-in-time calls made when the
  URL names an index, where the path comes out as `/{index}/{index}/_search/point_in_time`
  on create and `/{index}/_search/point_in_time` on delete; 3 are index calls made with a
  URL that names no index (`PUT /`, `POST /_close`, `POST /_open`); and 1 is
  `GET /_aliases`, which `multielasticdump` uses to list indices and the pinned specification
  does not describe. `create_pit` and `delete_pit` are credited through the cluster-URL forms.
- Two operations are credited through a path with a trailing slash: `indices.get`
  (`GET /{index}/` for `--type=index`) and `ism.get_policies` (`GET /_plugins/_ism/policies/`).
  Read strictly they would not match, and the total would be 31.
- Its legacy forms with a mapping type in the path (`/{index}/{type}/...`) are not listed;
  OpenSearch has no mapping types in paths.
- The operations are reached as the read or write side of a dump, chosen with `--type`
  (data, index, settings, analyzer, mapping, policy, alias, script, the three template
  kinds), not as commands for one operation each. `delete` is the per-document delete of
  `--delete`, and `indices.delete` is the cleanup step of `multielasticdump`. `--type=script`
  is handled by the code but not listed in its help; it gives `cluster.state` and
  `put_script`.
- No request exists in its source that is not wired to a command.
- Coverage is one axis. elasticdump offers things this CLI does not: copying data, mappings,
  settings, templates, aliases and ISM policies between clusters, files, S3 and CSV,
  transform scripts, parallel multi-index dumps, AWS request signing, client certificates
  and support for Elasticsearch and OpenSearch Serverless. This CLI offers commands for
  single operations with shaped output, cluster diagnostics, a default-deny permission
  gate, and JSON and JSON-RPC output on every command.

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

## Updating

The README overview, this document and the pictures follow the
[product-readme skill](https://github.com/iXab3r/EyeAuras.CliFactory/tree/main/.claude/skills/product-readme) in Factory; it holds the format, the measuring method and the
picture generator.

- Refresh when the version in a column title changes or the operation inventory changes.
- Edit the numbers in `docs/images/readme-images.json`, then regenerate the four SVGs with the
  skill's script from a Factory checkout:
  `node <factory>/.claude/skills/product-readme/scripts/readme-images.mjs docs/images/readme-images.json docs/images`.
  It prints the area table for this document and rejects columns that do not add up.
- A column for another tool is a dated measurement of one version. Re-measure it deliberately,
  with the skill's method, and update the version, the caveats and the credited list together.

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
<summary>The 37 operations reachable from curator-opensearch 0.0.13</summary>

- `info`: `GET /`
- `reindex`: `POST /_reindex`
- `search`: `POST /{index}/_search`
- `cluster.health`: `GET /_cluster/health`
- `cluster.put_settings`: `PUT /_cluster/settings`
- `cluster.state`: `GET /_cluster/state/{metric}`, `GET /_cluster/state/{metric}/{index}`
- `indices.close`: `POST /{index}/_close`
- `indices.create`: `PUT /{index}`
- `indices.delete`: `DELETE /{index}`
- `indices.delete_alias`: `DELETE /{index}/_alias/{name}`
- `indices.exists`: `HEAD /{index}`
- `indices.exists_alias`: `HEAD /_alias/{name}`
- `indices.forcemerge`: `POST /{index}/_forcemerge`
- `indices.get`: `GET /{index}`
- `indices.get_alias`: `GET /_alias`, `GET /_alias/{name}`, `GET /{index}/_alias`, `GET /{index}/_alias/{name}`
- `indices.get_settings`: `GET /{index}/_settings`
- `indices.open`: `POST /{index}/_open`
- `indices.put_settings`: `PUT /{index}/_settings`
- `indices.recovery`: `GET /{index}/_recovery`
- `indices.rollover`: `POST /{alias}/_rollover`, `POST /{alias}/_rollover/{new_index}`
- `indices.segments`: `GET /{index}/_segments`
- `indices.shrink`: `PUT /{index}/_shrink/{target}`
- `indices.stats`: `GET /{index}/_stats`, `GET /{index}/_stats/{metric}`
- `indices.update_aliases`: `POST /_aliases`
- `nodes.info`: `GET /_nodes`, `GET /_nodes/{node_id_or_metric}`
- `nodes.stats`: `GET /_nodes/stats`
- `snapshot.create`: `PUT /_snapshot/{repository}/{snapshot}`
- `snapshot.create_repository`: `PUT /_snapshot/{repository}`
- `snapshot.delete`: `DELETE /_snapshot/{repository}/{snapshot}`
- `snapshot.delete_repository`: `DELETE /_snapshot/{repository}`
- `snapshot.get`: `GET /_snapshot/{repository}/{snapshot}`
- `snapshot.get_repository`: `GET /_snapshot/{repository}`
- `snapshot.restore`: `POST /_snapshot/{repository}/{snapshot}/_restore`
- `snapshot.status`: `GET /_snapshot/_status`
- `snapshot.verify_repository`: `POST /_snapshot/{repository}/_verify`
- `tasks.get`: `GET /_tasks/{task_id}`
- `tasks.list`: `GET /_tasks`

</details>

<details>
<summary>The 33 operations reachable from elasticdump 6.125.1</summary>

- `bulk`: `POST /_bulk`, `PUT /_bulk`, `POST /{index}/_bulk`, `PUT /{index}/_bulk`
- `create_pit`: `POST /{index}/_search/point_in_time`
- `delete`: `DELETE /{index}/_doc/{id}`
- `delete_pit`: `DELETE /_search/point_in_time`
- `info`: `GET /`
- `put_script`: `POST /_scripts/{id}`
- `render_search_template`: `GET /_render/template/{id}`
- `scroll`: `GET /_search/scroll`, `POST /_search/scroll`
- `search`: `GET /_search`, `POST /_search`, `GET /{index}/_search`, `POST /{index}/_search`
- `cluster.get_component_template`: `GET /_component_template/{name}`
- `cluster.health`: `GET /_cluster/health/{index}`
- `cluster.put_component_template`: `PUT /_component_template/{name}`
- `cluster.state`: `GET /_cluster/state/{metric}`
- `indices.close`: `POST /{index}/_close`
- `indices.create`: `PUT /{index}`
- `indices.delete`: `DELETE /{index}`
- `indices.get`: `GET /{index}`
- `indices.get_alias`: `GET /{index}/_alias/{name}`
- `indices.get_data_stream`: `GET /_data_stream`
- `indices.get_index_template`: `GET /_index_template/{name}`
- `indices.get_mapping`: `GET /_mapping`, `GET /{index}/_mapping`
- `indices.get_settings`: `GET /_settings`, `GET /{index}/_settings`
- `indices.get_template`: `GET /_template/{name}`
- `indices.open`: `POST /{index}/_open`
- `indices.put_index_template`: `PUT /_index_template/{name}`
- `indices.put_mapping`: `PUT /{index}/_mapping`
- `indices.put_settings`: `PUT /_settings`, `PUT /{index}/_settings`
- `indices.put_template`: `PUT /_template/{name}`
- `indices.refresh`: `POST /_refresh`, `POST /{index}/_refresh`
- `indices.update_aliases`: `POST /_aliases`
- `ism.get_policies`: `GET /_plugins/_ism/policies`
- `ism.get_policy`: `GET /_plugins/_ism/policies/{policy_id}`
- `ism.put_policy`: `PUT /_plugins/_ism/policies/{policy_id}`

</details>

<details>
<summary>The 3 operations reachable from typed commands of the official CLI 1.2.0</summary>

- `knn.stats`: `GET /_plugins/_knn/stats`, `GET /_plugins/_knn/{node_id}/stats/{stat}`
- `knn.warmup`: `GET /_plugins/_knn/warmup/{index}`
- `search`: `GET /{index}/_search`

</details>

The pictures in the README are generated from [`images/readme-images.json`](images/readme-images.json).
