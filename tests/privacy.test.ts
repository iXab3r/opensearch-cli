import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error Repository tooling is intentionally plain JavaScript.
import { fixtureFindings, scanFixtureTree } from "../../scripts/fixture-privacy.mjs";

test("fixture privacy gate scans the fixture tree", async () => {
  const root = new URL("../../tests/fixtures/", import.meta.url);
  assert.deepEqual(await scanFixtureTree(root), []);
});
test("fixture privacy gate detects planted synthetic leaks", () => {
  for (const text of ['{"Authorization":"synthetic"}', 'https://internal.invalid', 'http://opensearch:9200', '10.20.30.40', '"fd00::1234"', `npm_${"x".repeat(36)}`]) assert.ok(fixtureFindings(text).length);
  assert.deepEqual(fixtureFindings('https://cluster.example.com 192.0.2.3 "2001:db8::1"'), []);
});

test("fixture privacy gate scans adjacent provenance README files", async t => {
  const root = await mkdtemp(join(tmpdir(), "opensearch-privacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "version-three"));
  await writeFile(join(root, "version-three", "README.md"), "Captured from http://opensearch:9200");
  const findings = await scanFixtureTree(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0].path, /README\.md$/);
});
