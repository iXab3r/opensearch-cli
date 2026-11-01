import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
// @ts-expect-error Repository tooling is intentionally plain JavaScript.
import { fixtureFindings } from "../../scripts/fixture-privacy.mjs";

test("fixture privacy gate scans the fixture tree", async () => {
  const root = new URL("../../tests/fixtures/", import.meta.url);
  for (const path of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!path.isFile() || path.name === "README.md") continue;
    const text = await readFile(`${path.parentPath}/${path.name}`, "utf8");
    assert.deepEqual(fixtureFindings(text), [], `Fixture privacy finding in ${path.name}`);
  }
});
test("fixture privacy gate detects planted synthetic leaks", () => {
  for (const text of ['{"Authorization":"synthetic"}', 'https://internal.invalid', '10.20.30.40', '"fd00::1234"', `npm_${"x".repeat(36)}`]) assert.ok(fixtureFindings(text).length);
  assert.deepEqual(fixtureFindings('https://cluster.example.com 192.0.2.3 "2001:db8::1"'), []);
});
