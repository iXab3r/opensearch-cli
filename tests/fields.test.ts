import assert from "node:assert/strict";
import test from "node:test";
import { http, HttpResponse } from "msw";
import { origin, setupExplore } from "./explore-fixture.js";

// Synthetic mapping and field-capability shapes shared by OpenSearch2.19/3.2.
const common = { _custom: { type: "keyword" }, user: { properties: { name: { type: "text", fields: { keyword: { type: "keyword" } } } } }, events: { type: "nested", properties: { code: { type: "integer" } } } };
async function setup(t: test.TestContext) {
  const state = await setupExplore(t);
  state.server.use(http.get(origin + "/search/:pattern/_mapping", ({ params }) => {
    assert.equal(params.pattern, "sample-*");
    return HttpResponse.json({ "sample-a": { mappings: { properties: { ...common, price: { type: "keyword" } } } },
      "sample-b": { mappings: { properties: { ...common, price: { type: "long" } } } } });
  }), http.get(origin + "/search/:pattern/_field_caps", ({ request }) => {
    assert.equal(new URL(request.url).searchParams.get("fields"), "*");
    return HttpResponse.json({ indices: ["sample-a", "sample-b"], fields: {
      _id: { _id: { type: "_id", searchable: true, aggregatable: false } },
      _data_stream_timestamp: { _data_stream_timestamp: { type: "_data_stream_timestamp", searchable: false, aggregatable: false } },
      _feature: { _feature: { type: "_feature", searchable: false, aggregatable: false } },
      price: { keyword: { type: "keyword", indices: ["sample-a"], searchable: true, aggregatable: true }, long: { type: "long", indices: ["sample-b"], searchable: true, aggregatable: true } },
      "user.name": { text: { type: "text", searchable: true, aggregatable: false } },
      "user.name.keyword": { keyword: { type: "keyword", searchable: true, aggregatable: true } },
    } });
  }));
  return state;
}
test("M2 fields flattens objects, nested fields and multi-fields, preserving type conflicts", async t => {
  const { fixture, app } = await setup(t);
  const rows = await fixture.json(app, ["fields", "list", "sample-*"]) as { name: string; types: string[]; conflict: boolean; indicesByType: Record<string, string[]> }[];
  assert.deepEqual(rows.map(row => row.name), ["_custom", "events", "events.code", "price", "user", "user.name", "user.name.keyword"]);
  assert.deepEqual(rows.find(row => row.name === "price"), { name: "price", types: ["keyword", "long"], conflict: true, indicesByType: { keyword: ["sample-a"], long: ["sample-b"] } });
  assert.deepEqual(rows.find(row => row.name === "user.name")!.types, ["text"]);
  assert.deepEqual(rows.find(row => row.name === "events")!.types, ["nested"]);
  const [reply] = await fixture.rpc(app, [["fields", "list", "sample-*"]]) as { result: unknown }[];
  assert.deepEqual(reply!.result, rows);
  const human = await fixture.run(app, ["fields", "list", "sample-*"]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /price\s+keyword, long\s+true\s+keyword: sample-a; long: sample-b/);
});
test("M2 fields --type keeps all conflict information for matching fields", async t => {
  const { fixture, app } = await setup(t);
  const rows = await fixture.json(app, ["fields", "list", "sample-*", "--type", "keyword"]) as { name: string; types: string[] }[];
  assert.deepEqual(rows.map(row => row.name), ["_custom", "price", "user.name.keyword"]);
  assert.deepEqual(rows.find(row => row.name === "price")!.types, ["keyword", "long"]);
});
test("M2 fields --filter matches dotted paths using star and question mark", async t => {
  const { fixture, app } = await setup(t);
  const rows = await fixture.json(app, ["fields", "list", "sample-*", "--filter", "user.n?me*"]) as { name: string }[];
  assert.deepEqual(rows.map(row => row.name), ["user.name", "user.name.keyword"]);
  assert.deepEqual(await fixture.json(app, ["fields", "list", "sample-*", "--filter", "absent.*"]), []);
});
test("M2 fields --include-meta includes capabilities for reserved metadata fields", async t => {
  const { fixture, app } = await setup(t);
  const rows = await fixture.json(app, ["fields", "list", "sample-*", "--include-meta"]) as { name: string; indicesByType: Record<string, string[]> }[];
  assert.deepEqual(rows.find(row => row.name === "_id")!.indicesByType, { _id: ["sample-a", "sample-b"] });
  assert.ok(rows.some(row => row.name === "_data_stream_timestamp"));
  assert.ok(rows.some(row => row.name === "_feature"));
  assert.ok(rows.some(row => row.name === "_custom"));
});

test("M2 fields scopes generated join fields and makes reserved join metadata opt-in", async t => {
  const { fixture, app, server } = await setupExplore(t);
  server.use(http.get(origin + "/search/:pattern/_mapping", () => HttpResponse.json({
    "sample-a": { mappings: { properties: { relation: { type: "join", relations: { product: "offer" } } } } },
    "sample-b": { mappings: { properties: { title: { type: "text" } } } },
  })), http.get(origin + "/search/:pattern/_field_caps", ({ request }) => {
    // Server omits per-type indices with a single observed type unless unmapped types are included.
    const includeUnmapped = new URL(request.url).searchParams.get("include_unmapped") === "true";
    const caps = (type: string) => ({ [type]: { type, searchable: true, aggregatable: true, ...(includeUnmapped ? { indices: ["sample-a"] } : {}) },
      ...(includeUnmapped ? { unmapped: { type: "unmapped", indices: ["sample-b"], searchable: false, aggregatable: false } } : {}) });
    return HttpResponse.json({ indices: ["sample-a", "sample-b"], fields: { relation: caps("join"), "relation#product": caps("parent"), _parent_join: caps("_parent_join") } });
  }));
  const rows = await fixture.json(app, ["fields", "list", "sample-*"]) as { name: string; indicesByType: Record<string, string[]> }[];
  assert.deepEqual({ indicesByType: rows.find(row => row.name === "relation#product")!.indicesByType,
    includesReserved: rows.some(row => row.name === "_parent_join") },
  { indicesByType: { parent: ["sample-a"] }, includesReserved: false });
  const meta = await fixture.json(app, ["fields", "list", "sample-*", "--include-meta"]) as { name: string; indicesByType: Record<string, string[]> }[];
  assert.deepEqual(meta.find(row => row.name === "_parent_join")!.indicesByType, { _parent_join: ["sample-a"] });
});
