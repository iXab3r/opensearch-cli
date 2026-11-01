# opensearch-cli

A general-purpose command-line client for [OpenSearch](https://opensearch.org/), built on
[CliFactory](https://github.com/iXab3r/EyeAuras.CliFactory) (`@eyeauras/cli-factory`).

> Profiles support Basic, bearer and open clusters; cluster info, health and index listing are available.
> Further OpenSearch commands are being delivered in [approved milestones](https://github.com/iXab3r/opensearch-cli/issues/7).
> The package has not been published.

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
with OpenSearch 2.x and 3.x; it requires `indices:monitor/stats` and `cluster:monitor/state` access.
No index documents, mappings or unrelated settings are returned.

JSON and RPC return the same array of `{name, health, status, primaries, replicas, docsCount, storeBytes}`.
Counts are numbers and sizes are numbers in bytes; unavailable statistics and health (for example on a closed
index) are `null`. Human sizes use binary units. No matches return `[]` successfully.

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

## Non-goals

- A UI, an MCP server or a hosted platform.
- Elasticsearch compatibility.
- Copying CliFactory sources; the framework is consumed as a package.

## License

[MIT](LICENSE)
