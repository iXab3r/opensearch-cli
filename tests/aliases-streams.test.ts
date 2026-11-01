import assert from "node:assert/strict";
import test from "node:test";
import { http, HttpResponse } from "msw";
import { origin, setupExplore } from "./explore-fixture.js";

// Synthetic 2.19/3.2 CAT aliases and GetDataStream shapes; provenance: docs/testing.md.
const aliases = [
  { alias: "sample-write", index: "sample-b", filter: "*", "routing.index": "west", "routing.search": "-", is_write_index: "true" },
  { alias: "sample-read", index: "sample-a", filter: "-", "routing.index": "-", "routing.search": "-", is_write_index: "false" },
  { alias: "sample-read", index: "sample-b", filter: "-", "routing.index": "-", "routing.search": "-", is_write_index: "-" },
];
const expectedAliases = [
  { alias: "sample-read", index: "sample-a", writeIndex: false, hasFilter: false, hasRouting: false },
  { alias: "sample-read", index: "sample-b", writeIndex: null, hasFilter: false, hasRouting: false },
  { alias: "sample-write", index: "sample-b", writeIndex: true, hasFilter: true, hasRouting: true },
];
test("M2 aliases list projects flags and uses the alias pattern", async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.get(origin + "/search/_cat/aliases/:pattern", ({ request, params }) => {
    assert.equal(params.pattern, "sample-*");
    const query = new URL(request.url).searchParams;
    assert.equal(query.get("format"), "json");
    assert.equal(query.get("h"), "alias,index,is_write_index,filter,routing.index,routing.search");
    return HttpResponse.json(aliases);
  }));
  assert.deepEqual(await fixture.json(app, ["aliases", "list", "sample-*"]), expectedAliases);
  const human = await fixture.run(app, ["aliases", "list", "sample-*"]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /Alias\s+Index\s+Write\s+Filter\s+Routing/);
  assert.match(human.stdout, /sample-write\s+sample-b\s+true\s+true\s+true/);
  const [reply] = await fixture.rpc(app, [["aliases", "list", "sample-*"]]) as { result: unknown }[];
  assert.deepEqual(reply!.result, expectedAliases);
});
test("M2 data streams list shows timestamp, numeric generation, backing count and health", async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.get(origin + "/search/_data_stream/:pattern", ({ params }) => {
    assert.equal(params.pattern, "sample-*");
    return HttpResponse.json({ data_streams: [{ name: "sample-events", timestamp_field: { name: "@timestamp" }, generation: 2,
      indices: [{ index_name: ".ds-sample-events-000001" }, { index_name: ".ds-sample-events-000002" }], status: "YELLOW" }] });
  }));
  const expected = [{ name: "sample-events", timestampField: "@timestamp", generation: 2, backingIndexCount: 2, health: "yellow" }];
  assert.deepEqual(await fixture.json(app, ["data-streams", "list", "sample-*"]), expected);
  const human = await fixture.run(app, ["data-streams", "list", "sample-*"]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /sample-events\s+@timestamp\s+2\s+2\s+yellow/);
  const [reply] = await fixture.rpc(app, [["data-streams", "list", "sample-*"]]) as { result: unknown }[];
  assert.deepEqual(reply!.result, expected);
});
for (const group of ["aliases", "data-streams"]) test(`M2 ${group} list shows a successful empty state`, async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.get(origin + (group === "aliases" ? "/search/_cat/aliases/*" : "/search/_data_stream/*"), () => HttpResponse.json(group === "aliases" ? [] : { data_streams: [] })));
  const human = await fixture.run(app, [group, "list"]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, group === "aliases" ? /No aliases found/ : /No data streams found/);
  assert.deepEqual(await fixture.json(app, [group, "list"]), []);
});
test("M2 data streams list represents a missing stream as an empty list", async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.get(origin + "/search/_data_stream/absent", () => HttpResponse.json({ error: { type: "resource_not_found_exception", reason: "synthetic missing data stream" }, status: 404 }, { status: 404 })));
  assert.deepEqual(await fixture.json(app, ["data-streams", "list", "absent"]), []);
});
