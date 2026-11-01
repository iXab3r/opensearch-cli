# API inventory

Generates the OpenSearch API inventory from the official
[OpenSearch API specification](https://github.com/opensearch-project/opensearch-api-specification)
and syncs it to GitHub issues: one `type:api-group` root issue per API group, with one `type:api`
sub-issue per logical operation (`x-operation-group`). The issues are a progress tracker; work is
planned through user stories ([story-driven delivery](https://github.com/iXab3r/EyeAuras.CliFactory/blob/main/docs/practices/story-driven-delivery.md)).

This tool is not part of the published CLI and has its own dependencies.

## Regenerate

`source.json` pins the specification revision and the supported OpenSearch majors.

```sh
git clone https://github.com/opensearch-project/opensearch-api-specification <spec>
git -C <spec> checkout <revision from source.json>
npm ci
node generate.mjs --spec <spec>
```

`inventory.json` is committed. Regenerating at the same revision produces the same file. To move to
a newer specification, change `revision` in `source.json`, regenerate, and review the diff.

## Sync issues

```sh
node sync-issues.mjs --repo iXab3r/opensearch-cli --project <number> --owner iXab3r            # dry run
node sync-issues.mjs --repo iXab3r/opensearch-cli --project <number> --owner iXab3r --apply    # write
```

Issues are matched by a hidden marker in their body, so a re-run creates only missing issues,
updates changed facts and links missing sub-issues. Use `--only <group>` for one group. Writes are
throttled (`--delay-ms`, default 1500) and back off on GitHub rate limits. Operations removed from
the specification are not closed automatically; review them by hand.

## Labels

| Label | Meaning |
|---|---|
| `type:api-group` / `type:api` | Root group issue / operation issue |
| `api:<group>` | API group, as named by the specification file |
| `os:3.x-only` | Not available in OpenSearch 2.x |
| `deprecated` | Every endpoint of the operation is deprecated |

An operation without `x-version-added` in the specification is treated as available in every
supported major.

## Test

```sh
npm test
```
