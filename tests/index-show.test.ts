import assert from "node:assert/strict";
import test from "node:test";
import { http, HttpResponse } from "msw";
import { origin, setupExplore } from "./explore-fixture.js";

// Synthetic GetIndex/GetMapping/GetSettings 2.19/3.2 wire examples; no captures.
const mappings = { dynamic: "strict", properties: { user: { properties: { name: { type: "text", fields: { keyword: { type: "keyword" } } } } } } };
const aliases = { "sample-current": { is_write_index: true, filter: { term: { status: "active" } } } };
const settings = { index: { number_of_shards: "2", number_of_replicas: "1", refresh_interval: "5s", creation_date: "1735689600000", uuid: "synthetic-index-uuid" } };
const expectedSettings = { primaries: 2, replicas: 1, refreshInterval: "5s", createdAt: "2025-01-01T00:00:00.000Z", uuid: "synthetic-index-uuid" };
test("M2 indices show returns settings, aliases and complete mappings in JSON and RPC", async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.get(origin + "/search/sample-a", () => HttpResponse.json({ "sample-a": { aliases, settings, mappings } })));
  const expected = { name: "sample-a", aliases, settings: expectedSettings, mappings };
  assert.deepEqual(await fixture.json(app, ["indices", "show", "sample-a"]), expected);
  const [reply] = await fixture.rpc(app, [["indices", "show", "sample-a"]]) as { result: unknown }[];
  assert.deepEqual(reply!.result, expected);
  const human = await fixture.run(app, ["indices", "show", "sample-a"]);
  assert.equal(human.exitCode, 0, human.stderr);
  for (const text of ["sample-current", "primaries", "5s", "2025-01-01", "synthetic-index-uuid", "keyword", "strict"]) assert.ok(human.stdout.includes(text), human.stdout);
  assert.doesNotMatch(human.stdout, /1735689600000|\[Object\]|\{\s*"/);
});
for (const section of ["settings", "mappings", "aliases"]) test(`M2 indices show --section ${section} returns only that section`, async t => {
  const { fixture, server, app } = await setupExplore(t);
  const expected = section === "settings" ? expectedSettings : section === "mappings" ? mappings : aliases;
  server.use(http.get(origin + "/search/sample-a" + (section === "settings" ? "/_settings" : section === "mappings" ? "/_mapping" : ""), () =>
    HttpResponse.json({ "sample-a": { [section]: section === "settings" ? settings : expected } })));
  assert.deepEqual(await fixture.json(app, ["indices", "show", "sample-a", "--section", section]), expected);
});
// The explicitly accepted Story6 missing-index workflow, not a hypothetical failure permutation.
test("M2 indices show identifies a missing index and suggests listing indices", async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.get(origin + "/search/absent", () => HttpResponse.json({ error: { type: "index_not_found_exception" } }, { status: 404 })));
  const json = await fixture.run(app, ["indices", "show", "absent", "--json"]);
  assert.notEqual(json.exitCode, 0);
  const error = JSON.parse(json.stderr).error;
  assert.equal(error.code, "index.notFound");
  assert.deepEqual(error.next, [["indices", "list", "--profile", "default"]]);
  const human = await fixture.run(app, ["indices", "show", "absent"]);
  assert.match(human.stderr, /Next:\s+opensearch-cli indices list/);
});
