#!/usr/bin/env node
// Generates inventory.json from a checkout of the OpenSearch API specification at the pinned revision.
// Usage: node generate.mjs --spec <path-to-opensearch-api-specification-checkout>
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildInventory } from "./inventory-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { spec: { type: "string" } } });
if (!values.spec) {
  console.error("Missing --spec <path>. Clone the specification repository and pass its path.");
  process.exit(2);
}

const source = JSON.parse(readFileSync(join(here, "source.json"), "utf8"));
const head = execFileSync("git", ["-C", values.spec, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== source.revision) {
  console.error(`Specification checkout is at ${head}; source.json pins ${source.revision}.`);
  console.error(`Next: git -C ${values.spec} fetch --depth 1 origin ${source.revision} && git -C ${values.spec} checkout ${source.revision}`);
  process.exit(1);
}

const directory = join(values.spec, source.namespacesPath);
const files = readdirSync(directory)
  .filter((name) => name.endsWith(".yaml"))
  .map((name) => ({ name, text: readFileSync(join(directory, name), "utf8") }));
const inventory = buildInventory(files, source);
writeFileSync(join(here, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`${inventory.counts.groups} groups, ${inventory.counts.operations} operations`);
