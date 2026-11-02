# opensearch-cli

A general-purpose command-line client for [OpenSearch](https://opensearch.org/), built on
[CliFactory](https://github.com/iXab3r/EyeAuras.CliFactory) (`@eyeauras/cli-factory`).

> **Source tree:** M1–M3 plus M4 diagnostics and M5 writes.
> npm `0.1.0` provides M1 Connect and M2 Explore data.
> Further OpenSearch commands are being delivered in [approved milestones](https://github.com/iXab3r/opensearch-cli/issues/7).
> Install with `npm install --global @eyeauras/opensearch-cli` (Node.js 22+).

## Development

Use Node 22 or 24 and the pinned npm version. Run `npm ci && npm test` for offline CLI tests,
`npm run test:package` for an isolated installation check, or
`dotnet run --project build -- --target Verify` for the complete CI check.
See [testing](docs/testing.md) and [release preparation](docs/release.md).

## Connect and inspect

```text
opensearch-cli profile configure dev --url https://cluster.example.com:9200 --auth basic --username operator --password-stdin
opensearch-cli profile configure prod --url https://search.example.com --auth bearer --token-stdin
opensearch-cli profile configure local --url http://localhost:9200 --auth none
opensearch-cli auth status --profile dev
opensearch-cli cluster info --profile dev
opensearch-cli cluster health --profile dev --index 'sample-*' --level indices
opensearch-cli cluster health --profile dev --wait-for-status green --timeout 30s --json
```

Pass a password or bare bearer token on stdin; credentials stay in the platform secret store.
Basic passwords preserve whitespace, removing one final line ending. Basic login requires both
`--username` and `--password-stdin`. Open profiles use no credential.
Cluster info reports unsupported distributions/versions with a stderr warning and retains their metadata.
Cluster health reads red state successfully; a wait timeout fails with the observed health on stdout.
`ReadOnly` is enabled by default. `Update` and `Delete` start disabled.

## List indices

```text
opensearch-cli indices list
opensearch-cli indices list 'sample-*' --health yellow
opensearch-cli indices list --include-hidden --json
```

Rows are sorted by name and show health, open/close status, primary and replica shard counts,
document count and total store size. Hidden and system indices are excluded by metadata classification,
even when named explicitly; `--include-hidden` includes both kinds visible to your profile.
The default read uses CAT statistics plus a narrow cluster-state metadata projection, compatible
with OpenSearch 2.x and 3.x. Server permissions must allow `indices:monitor/stats`,
`indices:monitor/settings/get`, `cluster:monitor/state` and `cluster:monitor/health`.
No index documents, mappings or unrelated settings are returned.

JSON and RPC return the same array of `{name, health, status, primaries, replicas, docsCount, storeBytes}`.
Counts are numbers and sizes are numbers in bytes; unavailable statistics and health (for example on a closed
index) are `null`. Human sizes use binary units. No matches return `[]` successfully.

## Explore definitions and count documents

```text
opensearch-cli aliases list 'sample-*'
opensearch-cli data-streams list 'sample-*'
opensearch-cli indices show sample-a
opensearch-cli indices show sample-a --section mappings --json
opensearch-cli fields list 'sample-*' --filter 'user.*'
opensearch-cli fields list 'sample-*' --type keyword --include-meta --json
opensearch-cli count 'sample-*'
opensearch-cli count sample-a --q 'status:500'
opensearch-cli count sample-a --query-file query.json --fail-on-partial --json
opensearch-cli count sample-a --query-file -
```

Alias rows show each target index, the nullable write-index flag and filter/routing presence.
Data streams show their timestamp field, generation, backing-index count and health. Empty lists
are successful. Index inspection returns `{name, settings, aliases, mappings}`; settings normalize
shard counts and creation time, while mapping/alias definitions retain OpenSearch's structure.
`--section settings|mappings|aliases` returns only that section. A missing index reports
`index.notFound` and suggests `indices list`. Arbitrary definitions use Core's structured human view.

Fields include object, nested and multi-field dotted paths. Each row retains `types`, `conflict`
and `indicesByType`; `--type` selects matching fields without hiding their other conflicting types.
`--filter` matches full paths with `*` and `?`. Reserved metadata fields require `--include-meta`;
ordinary underscore-prefixed user fields stay visible.

Query files contain the Query DSL **query object**, for example `{"term":{"status":500}}`, rather
than a full search body. Relative paths resolve from the command's working directory. `-` reads
fresh CLI stdin; JSON-RPC callers use a file because stdin carries the RPC protocol. Choose either
`--q` or `--query-file`. Count returns numeric `count`, normalized `_shards` statistics, and
`partial: {failedShards, totalShards, failures}`. Shard failures warn human callers on stderr;
`--fail-on-partial` exits with `search.partial` and retains the result on stdout/RPC error result.
All these commands are ReadOnly and use the selected profile's server permissions.
Shard failure details retain index, shard, node and type/reason/cause chains. Diagnostic text
uses Core's credential redaction before the domain result reaches any output or caller.

## Search and read documents

```text
opensearch-cli search sample-* --q "category:example" --fields title,category --sort rank:desc --size 20
opensearch-cli search sample-a --body-file request.json
opensearch-cli search sample-a --body-file -
opensearch-cli search sample-* --all --max-results 50000 --json > results.ndjson
opensearch-cli search sample-a --all --max-results 1000 --tie-breaker unique_key
opensearch-cli docs get sample-a doc-1
opensearch-cli docs get sample-a doc-1 doc-2
opensearch-cli docs exists sample-a doc-1
opensearch-cli aggregate terms sample-a --field category --size 10
opensearch-cli aggregate histogram sample-a --field created --interval 1h
```

Search returns one page by default (10 hits). `--fields` selects `_source` fields; `--sort` takes
comma-separated fields with optional `:asc`/`:desc`. `--body-file` accepts a complete search body
unchanged; `-` reads fresh stdin. RPC callers use a file. Choose either `--q` or a body.
Explicit size/source/sort flags with a body are sent as search URL parameters.

Human output shows hit metadata and source records. JSON and RPC retain search response fields,
including highlights and arbitrary nested aggregations, plus `partial` signals for timeouts, early termination,
failed shards and lower-bound totals. Human output warns on stderr; `--fail-on-partial` fails with
`search.partial` while retaining the result on stdout (RPC: error result). A `gte` total prints `≥`.
Invalid server query syntax returns `query.invalid` with its diagnostic reason.

Single-document reads retain source and version/sequence metadata. Multiple IDs use one multi-get
and return an array with each item's found/error state; a single missing ID fails with
`document.notFound`. `docs exists` returns a boolean. Aggregation helpers are size-zero searches:
terms shows bucket counts and error bounds; histogram uses a fixed interval and ISO bucket dates.
Use a full search body for stats, percentiles, calendar intervals or nested aggregations.
All commands are ReadOnly.

`--all` opens a point in time (PIT), pages with `search_after` and deletes the PIT when finished,
including after failure or cancellation. It requires an explicit positive `--max-results` budget.
`--size` sets the page size (default 1,000); each request stays within the remaining budget plus
one lookahead hit. Overflow fails with `search.budgetExceeded`: `retrievedCount` counts yielded
hits and `observedCount` includes the lookahead. A lower-bound total does not decide overflow or
completion. First Ctrl+C cancels the command and allows PIT cleanup; cleanup has a separate 5s deadline.
Failed cleanup is reported, retaining any original failure.

OpenSearch 3.3+ adds an automatic `_index`/`_shard_doc` tie-breaker, including for multi-index
selections. On 2.4–3.2, pass `--tie-breaker` naming a present, sortable doc-values field whose values
you guarantee are unique across the entire selection. PIT is unavailable before 2.4; unavailable
PITs fail clearly. No index settings change and no unstable paging fallback is used.

For `--all`, ordinary `--json` emits one unchanged hit per NDJSON line. Human output, programmatic
execute and JSON-RPC receive an array, buffered within the budget; RPC still returns one frame.
On failure, emitted hit lines remain, with the error and count metadata on stderr. Repeated partial
page warnings print once per distinct warning on stderr, including in JSON/RPC; warning lines may
precede the final JSON error envelope. `--fail-on-partial` fails before yielding the incomplete page
and retains its partial/count metadata. A nonzero exit means the hit stream did not complete.
`--all` accepts query/source/sort input from a body, but owns paging keys and returns hits only;
use one-page search for `pit`, `from`, `search_after` or aggregation bodies.

## Agreed direction

- **Universal product.** The CLI speaks OpenSearch concepts: indices, mappings, Query DSL,
  search, aggregations, pagination, documents and cluster state. It carries no knowledge of any
  particular deployment, application, log schema or business process.
- **Supported versions:** OpenSearch 2.x and 3.x. Amazon OpenSearch Service is tracked separately
  and is not a commitment.
- **CliFactory owns the common mechanics:** command declarations, help, human/JSON output,
  JSON-RPC, profiles, secret storage and permission gates. This repository owns only the
  OpenSearch API and its semantics.
- **Standalone process, no IPC.** Calls are cheap and the CLI keeps no state between invocations.
- **Build and release run on TeamCity**, not GitHub Actions.

Maintainers: follow the [staged release flow](docs/release.md).

## Non-goals

- A UI, an MCP server or a hosted platform.
- Elasticsearch compatibility.
- Copying CliFactory sources; the framework is consumed as a package.

## Diagnose queries and cluster resources

```text
opensearch-cli query validate sample-a --body-file query-body.json --explain
opensearch-cli query explain sample-a doc-1 --body-file query-body.json
opensearch-cli analyze --analyzer standard 'Quick Brown Fox'
opensearch-cli analyze --index sample-a --field title 'Quick Brown Fox'
opensearch-cli nodes list
opensearch-cli nodes stats node-a --metric jvm,fs,os
opensearch-cli shards list sample-a --state unassigned
opensearch-cli shards explain
opensearch-cli shards explain --index sample-a --shard 0 --primary
opensearch-cli tasks list --actions '*search*' --detailed
opensearch-cli tasks show node-a:7
opensearch-cli tasks cancel node-a:7
```

Query files contain the native body, for example `{"query":{"match_all":{}}}`.
Validation returns `valid:false` as a successful observation; explain preserves the score tree.
Analyzer tokens include positions and offsets. Node lists normalize resource observations to
numbers (bytes for disk); unavailable observations are `null`. Node stats preserve selected native
metrics. Allocation without a selection explains OpenSearch's first unassigned shard; no unassigned
shard returns `{unassigned:false}`. Selected shards default to replica unless `--primary` is supplied.
Task reads preserve status, completed results and errors; cancelling requires Update and requests
cancellation without claiming the task has already stopped. All other diagnostics are ReadOnly.
Human node/task observations show instants; machine outputs retain native numeric timestamps.
Native shard/node failure diagnostics are sanitized before presentation while their identities,
counts and metrics are retained. Replica failures remain visible alongside a successful primary write.

## Write documents and manage indices

```text
opensearch-cli permissions grant Update --profile dev
opensearch-cli docs index sample-a doc-1 --body-file document.json --refresh wait_for
opensearch-cli docs index sample-a doc-2 --create --body-file document.json
opensearch-cli docs update sample-a doc-1 --body-file update.json --if-seq-no 7 --if-primary-term 2
opensearch-cli bulk load sample-a --file documents.ndjson --id-field id --batch-size 1000
opensearch-cli indices create sample-b --body-file index.json --shards 1 --replicas 0
opensearch-cli reindex --source sample-a --dest sample-b --q 'title:example' --no-wait
opensearch-cli aliases swap sample-alias --from sample-a --to sample-b
opensearch-cli aliases add sample-alias sample-b
opensearch-cli aliases remove sample-alias sample-a
opensearch-cli permissions grant Delete --profile dev
opensearch-cli docs delete sample-a doc-1
opensearch-cli docs delete-by-query sample-a --q 'title:example' --wait
opensearch-cli indices delete sample-a
opensearch-cli bulk run --file actions.ndjson
```

Update input is the native OpenSearch update body, for example `{"doc":{"title":"Updated"}}`;
scripts and upsert fields follow OpenSearch semantics. Indexing without an ID lets OpenSearch create
one. `--create` requires an ID and uses the create-only API. Concurrency flags must be supplied together.
409 reports `document.conflict`. Index creation checks existence, then applies settings/mappings;
`--shards` and `--replicas` override those body settings. An unacknowledged mutation fails with its
observed response because the remote outcome is uncertain.

Update gates indexing, update, bulk, index creation, reindex, alias changes and task cancellation.
Delete gates document/index deletion and delete-by-query. Both categories start disabled and are
profile-specific. `bulk run` also requires Delete when an explicit delete action appears. Bulk input
is completely parsed before authentication or HTTP, and the inspected snapshot is used for sending.
`bulk load` accepts one document per line; `bulk run` accepts native action/document NDJSON. Empty files
return zero totals. Malformed input includes its original line number and sends no batches.
Reports contain `succeeded`, `failed`, `took` and `failures` with input line, `_id`, status and reason;
`bulk.partial` exits nonzero with the full report. Submitted mutations are not retried or rolled back.
A native delete of a missing document counts as successful. If a later request fails,
`bulk.requestFailed` retains known counts, timing and item failures; `unconfirmedCount` is the current
batch without item receipts and `remainingCount` is the number of actions not yet sent.

Reindex and delete-by-query wait by default; `--no-wait` returns the server task ID and a `tasks show`
follow-up. Completed failures or timeout exit nonzero with final counts. `tasks show` reports an
observed error as data. Alias swap checks the current target and sends one atomic remove/add request,
with `must_exist` on the removal; add/remove also require acknowledgement. Swap adds a plain alias
without copying filtering, routing or write-index options. Index delete refuses `*` / `?` patterns and
`_all` unless `--allow-wildcards` is provided; OpenSearch's own destructive-operation settings still apply.
Native failed operation bodies retain their counts even when OpenSearch returns an HTTP failure
status. Ordinary HTTP error envelopes keep their HTTP error code.

## License

[MIT](LICENSE)
