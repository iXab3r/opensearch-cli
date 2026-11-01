#!/usr/bin/env node
// Creates or updates the API inventory issues from inventory.json. Idempotent: issues are matched by
// the hidden marker in their body. Dry run by default; --apply writes.
// Usage: node sync-issues.mjs --repo owner/name [--project <number> --owner <login>] [--only <group>] [--apply]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  groupBody, groupLabels, groupMarker, groupTitle,
  operationBody, operationLabels, operationMarker, operationTitle,
} from "./issue-render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    project: { type: "string" },
    owner: { type: "string" },
    only: { type: "string" },
    apply: { type: "boolean", default: false },
    "delay-ms": { type: "string", default: "1500" },
  },
});
if (!values.repo) {
  console.error("Missing --repo owner/name.");
  process.exit(2);
}
const repo = values.repo;
const delay = Number(values["delay-ms"]);
const apply = values.apply;
const inventory = JSON.parse(readFileSync(join(here, "inventory.json"), "utf8"));

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
}
const api = (args, input) => JSON.parse(gh(["api", ...args], input) || "null");
const paginate = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();

async function write(description, action) {
  if (!apply) {
    console.log(`[dry-run] ${description}`);
    return null;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const result = action();
      console.log(description);
      await sleep(delay);
      return result;
    } catch (error) {
      const text = String(error.stderr ?? error.message);
      if (attempt >= 5 || !/rate limit|secondary|abuse|HTTP 5\d\d/i.test(text)) throw error;
      const wait = 60_000 * attempt;
      console.log(`Rate limited; waiting ${wait / 1000}s before retrying: ${description}`);
      await sleep(wait);
    }
  }
}

// Labels.
const labelColors = { "type:api-group": "1d76db", "type:api": "bfdadc", deprecated: "fef2c0", "os:unsupported": "e4e669" };
const wanted = new Set();
const groups = inventory.groups.filter((group) => !values.only || group.name === values.only);
for (const group of groups) {
  groupLabels(group).forEach((label) => wanted.add(label));
  group.operations.forEach((op) => operationLabels(group, op, inventory).forEach((label) => wanted.add(label)));
}
const existingLabels = new Set(paginate(`repos/${repo}/labels?per_page=100`).map((label) => label.name));
for (const label of [...wanted].sort()) {
  if (existingLabels.has(label)) continue;
  const color = labelColors[label] ?? (label.startsWith("api:") ? "c2e0c6" : "d4c5f9");
  await write(`label ${label}`, () => api([`repos/${repo}/labels`, "-f", `name=${label}`, "-f", `color=${color}`]));
}

// Existing inventory issues, by marker.
const existing = new Map();
for (const label of ["type:api-group", "type:api"]) {
  for (const issue of paginate(`repos/${repo}/issues?state=all&per_page=100&labels=${encodeURIComponent(label)}`)) {
    const marker = issue.body?.match(/<!-- api-inventory:[^>]+ -->/)?.[0];
    if (marker && !issue.pull_request) existing.set(marker, issue);
  }
}

async function upsert(marker, title, body, labels) {
  const found = existing.get(marker);
  const payload = JSON.stringify({ title, body, labels });
  if (!found) {
    return write(`create ${title}`, () => api([`repos/${repo}/issues`, "--method", "POST", "--input", "-"], payload));
  }
  const sameLabels = labels.every((label) => found.labels.some((l) => l.name === label));
  if (found.title === title && found.body === body && sameLabels) return found;
  const merged = [...new Set([...found.labels.map((l) => l.name), ...labels])];
  return (await write(`update #${found.number} ${title}`, () => api([`repos/${repo}/issues/${found.number}`, "--method", "PATCH", "--input", "-"],
    JSON.stringify({ title, body, labels: merged })))) ?? found;
}

async function addToProject(issue) {
  if (!values.project || !issue) return;
  await write(`project add #${issue.number}`, () => gh(["project", "item-add", values.project, "--owner", values.owner, "--url", issue.html_url]));
}

let created = 0;
for (const group of groups) {
  const root = await upsert(groupMarker(group), groupTitle(group), groupBody(group, inventory), groupLabels(group));
  if (!existing.has(groupMarker(group))) { created++; await addToProject(root); }
  const linked = root?.number ? new Set(paginate(`repos/${repo}/issues/${root.number}/sub_issues?per_page=100`).map((i) => i.id)) : new Set();
  for (const operation of group.operations) {
    const marker = operationMarker(operation);
    const issue = await upsert(marker, operationTitle(operation), operationBody(group, operation, inventory),
      operationLabels(group, operation, inventory));
    if (!existing.has(marker)) { created++; await addToProject(issue); }
    if (root?.number && issue?.id && !linked.has(issue.id)) {
      await write(`link #${issue.number} under #${root.number}`, () =>
        api([`repos/${repo}/issues/${root.number}/sub_issues`, "--method", "POST", "-F", `sub_issue_id=${issue.id}`]));
    }
  }
}
console.log(`${apply ? "Created" : "Would create"} ${created} issues across ${groups.length} groups.`);
