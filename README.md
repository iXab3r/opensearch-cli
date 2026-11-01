# opensearch-cli

A general-purpose command-line client for [OpenSearch](https://opensearch.org/), built on
[CliFactory](https://github.com/iXab3r/EyeAuras.CliFactory) (`@eyeauras/cli-factory`).

> **Status: planning.** Nothing is implemented or published yet. Scope, commands and
> authentication are being defined in [GitHub Issues](https://github.com/iXab3r/opensearch-cli/issues).
> This README describes agreed direction only; anything not listed here is undecided.

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
