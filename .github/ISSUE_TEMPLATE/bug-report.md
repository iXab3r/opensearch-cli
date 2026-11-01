---
name: Bug report
about: Report a reproducible defect without exposing private service data
title: "[Bug] "
labels: bug
assignees: ""
---

## Impact

<!-- Who is affected and which behavior is blocked or unsafe? -->

## Observed behavior

<!-- Include safe evidence only. Never paste credentials, private logs, or raw service payloads. -->

## Expected behavior

## Reproduction

<!-- Minimal argv/steps. Redact profile values and all secrets. -->

## Environment

<!-- OS, Node and opensearch-cli versions, OpenSearch version and distribution, auth type. No URLs, credentials or index names from private clusters. -->

## Suspected boundary

<!-- Likely owner: this product, CliFactory, or tooling/docs. Use existing metadata when suitable.
Distinguish a hypothesis from a confirmed cause; reassess at closure. Never classify by a warning alone. -->

## Acceptance criteria

- [ ] A deterministic regression test reproduces the behavioral defect, or a documentation/non-behavioral defect has justified static evidence.
- [ ] The expected behavior is restored without weakening adjacent contracts.
- [ ] Focused verification and `npm test` pass.
- [ ] CI and closing implementation evidence are linked.
- [ ] Classification matches the delivered fix; any acceptance scope reduction has explicit owner agreement and linked follow-ups.
