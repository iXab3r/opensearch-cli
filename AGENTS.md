# opensearch-cli — agent router

A general-purpose OpenSearch CLI built on CliFactory. This file is the entry point for coding
agents. Keep it compact; durable design belongs in `docs/`, scope and acceptance in GitHub Issues.

## Framework

The product consumes `@eyeauras/cli-factory` as a pinned npm dependency. Before changing commands,
profiles, auth, output or tests, read the framework contract at the pinned version:

- [`AGENTS.md`](https://github.com/iXab3r/EyeAuras.CliFactory/blob/main/AGENTS.md) — universal laws
- [`docs/DESIGN.md`](https://github.com/iXab3r/EyeAuras.CliFactory/blob/main/docs/DESIGN.md) — runtime contract
- [`docs/integrations.md`](https://github.com/iXab3r/EyeAuras.CliFactory/blob/main/docs/integrations.md) — external integration path
- [`docs/testing.md`](https://github.com/iXab3r/EyeAuras.CliFactory/blob/main/docs/testing.md) — mock-first tests and sanitization
- [`docs/roles/cli-writer.md`](https://github.com/iXab3r/EyeAuras.CliFactory/blob/main/docs/roles/cli-writer.md) — any text a person reads at the terminal

Those laws apply here unless this file says otherwise.

## Product rules

1. **Universal product.** Code, docs, examples, fixtures and tests use only OpenSearch concepts and
   clearly synthetic data. Never add endpoints, credentials, index names, user identities, incidents
   or schemas from any real deployment.
2. **Ordinary product CLI.** The code models OpenSearch, not AI workflows. A mechanism that is useful
   to CLIs in general belongs in CliFactory, not here.
3. **Boundary with CliFactory.** CliFactory owns command declarations, help, rendering, JSON,
   JSON-RPC, profiles, secrets and permissions. This repository owns the OpenSearch REST API, DTOs,
   Query DSL handling, pagination, and partial-result signals (`timed_out`, `_shards.failures`,
   `hits.total.relation`). Do not copy or fork framework code.
4. **Framework extensions need owner approval.** Propose a CliFactory change only as a separate issue
   with an analysis of its existing consumers. Do not open issues or PRs in CliFactory without it.
5. **No IPC.** The CLI is a standalone process; do not add `@eyeauras/cli-factory-ipc`.
6. **Versions.** Support OpenSearch 2.x and 3.x. Amazon OpenSearch Service is separate, optional work.
7. **CI is TeamCity.** Do not add GitHub Actions workflows.
8. **Offline tests.** Default tests mock `fetch` with MSW and never contact a cluster. Real-cluster
   proof is local-only, read-only and never runs in CI.
9. **Privacy gate before every commit.** Check the tracked tree and staged diff for credentials,
   private hosts and unsanitized service responses. Unresolved findings block the commit.

## Delivery

- GitHub Issues is the tracker. Scope and acceptance live in the issue; evidence in the issue or PR.
- New branches default to `bugfix/`, unless an exact name is requested. Never use `codex/`.
- Never rewrite pushed history or force-push.
- Planning approval does not authorize npm publication, TeamCity configuration changes or work against
  real clusters; each needs explicit owner approval.
