# Offline tests and response fixtures

Run `npm ci`, `npm --prefix tools/api-inventory ci`, then `npm test`. Tests use MSW at native
fetch and the real CLI command tree. They never require a cluster, containers or credentials.
`npm run test:package` separately downloads public dependencies into an isolated temporary prefix.

## Preparing fixtures

A real response may be collected only with the owner's permission, using a configured current-user
profile and its secret store. Discovery may use a plain request before the CLI supports an endpoint.
Keep captures under ignored `.workspace/` or profile AppData, never directly in `tests/fixtures`.
Never record the source server URL in tracked files, issue/PR text or logs.

Replace host names, IPs/ports, cluster names/UUIDs, node names/IDs, indices, aliases, document IDs,
source contents, users/roles and identifying field names with synthetic values. Remove credentials,
cookies, headers, signed URLs and unrelated fields. Preserve only consumed fields and structural
signals: `took`, `timed_out`, `_shards` and failures, total hit value/relation, sort keys, PIT IDs and
error types/reasons. Error reasons must also be synthetic.

Record fixture provenance and OpenSearch major.minor in an adjacent README. For versions unavailable
on the owner's server, derive a minimal fixture from official documentation and identify that source.
A fixture PR lists the replaced fields; review the fixture and staged diff before commit.

`npm test` scans fixtures for credential headers, token patterns, non-reserved IPs and host names
outside example.com/example.org/localhost. Reserved documentation IPs are permitted. This guard does
not prove sanitization: names, schemas and document contents still require human review.

## Local profile proof

With the first service commands, `scripts/proof.mjs --profile <name>` invokes a temporary installed tarball
through its normal current-user profile and secret store. It refuses CI, accepts no endpoint/token
or arbitrary argv, runs only auth status, cluster info and cluster-level health, prints pass summaries and
never saves fixtures automatically. It is separate from `npm test`; running it needs owner permission.

## M1 wire sources

Documentation-derived fixtures use the [Cluster Information API](https://docs.opensearch.org/latest/api-reference/cluster-api/info/),
[Cluster Health API](https://docs.opensearch.org/latest/api-reference/cluster-api/cluster-health/) and
[Security authinfo API](https://docs.opensearch.org/latest/security/api/authentication/auth-info/).
Metadata fixtures target OpenSearch 2.19 and 3.2; the consumed fields are shared across those majors.

## Index-list fixtures

Story 4's fixtures model the consumed OpenSearch 2.19 and 3.2 CAT/metadata wire shapes.
They are synthetic, documentation/source-derived examples, not real-service captures:
[CAT indices](https://docs.opensearch.org/latest/api-reference/cat/cat-indices/),
[2.19 CAT implementation](https://github.com/opensearch-project/OpenSearch/blob/2.19/server/src/main/java/org/opensearch/rest/action/cat/RestIndicesAction.java),
and [2.0 index metadata serialization](https://github.com/opensearch-project/OpenSearch/blob/2.0/server/src/main/java/org/opensearch/cluster/metadata/IndexMetadata.java).
The classifier uses metadata available before CAT's 3.9-only system filter. The fixture privacy
scanner recognizes the exact JSON column keys `docs.count` and `store.size` as protocol names;
it continues to scan their values and adjacent provenance for private hosts and credentials.

## Explore-data wire sources

The inline synthetic fixtures in `aliases-streams.test.ts` model OpenSearch 2.19/3.2
[CAT aliases](https://docs.opensearch.org/latest/api-reference/cat/cat-aliases/) and
[GetDataStream serialization](https://github.com/opensearch-project/OpenSearch/blob/2.19/server/src/main/java/org/opensearch/action/admin/indices/datastream/GetDataStreamAction.java).
All names, IDs, routing values and counts are invented; no captures or real endpoints are used.
`index-show.test.ts` uses synthetic 2.19/3.2 [Get Index](https://docs.opensearch.org/latest/api-reference/index-apis/get-index/),
[Get Mapping](https://docs.opensearch.org/latest/api-reference/index-apis/get-mapping/) and
[Get Settings](https://docs.opensearch.org/latest/api-reference/index-apis/get-settings/) shapes.
Aliases-only inspection projects Get Index; it does not add another API operation. Arbitrary
mapping/alias details use Core's structured human fallback; creation dates are ISO instants.
`fields.test.ts` combines those mapping shapes with [field capabilities](https://docs.opensearch.org/latest/api-reference/search-apis/field-caps/)
from 2.19/3.2: nested objects, multi-fields, an underscore-prefixed user field, reserved metadata
and a cross-index type conflict. Capabilities' optional indices list is preserved when supplied;
mapping membership fills the common-type case. Fixtures contain no real schema or field values.
`count.test.ts` models the [Count API](https://docs.opensearch.org/latest/api-reference/search-apis/count/)
2.19/3.2 shape and uses real temporary query files plus invocation stdin; only HTTP is mocked.
Count retains shard failures, warns human callers, and supports `search.partial` with the result
under `--fail-on-partial`. Stdin queries require fresh CLI stdin; RPC uses query files.
The source-derived join fixture covers generated field membership via `include_unmapped=true`
and the reserved `_parent_join` marker. The mappings-section fixture rejects the unsupported
`flat_settings` parameter, matching the 2.19/3.2 REST handler. Strict human count diagnostics
retain failed/total shards and first failure reasons through Core's cause rendering.
The partial-count regression also injects synthetic credential patterns in nested cause text and
checks ordinary/strict human, JSON, RPC and execute results. The client projects supported shard
identity/cause fields and applies Core's diagnostic redaction before constructing both failure copies.
Metadata fixtures include built-in `_data_stream_timestamp` and bundled mapper-extras `_feature`,
based on the 2.19/3.2 mapper registrations, while preserving an ordinary `_custom` user field.
