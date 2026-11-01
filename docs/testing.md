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

With the first service commands, `scripts/proof.mjs --profile <name>` will invoke an installed package
through its normal current-user profile and secret store. It must refuse CI, accept no endpoint/token
or arbitrary argv, run only a fixed bounded ReadOnly inventory, print pass/count/skip summaries and
never save fixtures automatically. It is separate from `npm test`; running it needs owner permission.
