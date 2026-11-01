import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createCli } from "@eyeauras/cli-factory";
import { createCliFixture } from "@eyeauras/cli-factory/testing";
import { createDefinition } from "../src/cli.js";

const origin = "https://cluster.example.com";
const rows = JSON.parse(await readFile(new URL("../../tests/fixtures/m2/indices.json", import.meta.url), "utf8")) as Record<string, string | null>[];
const classification = JSON.parse(await readFile(new URL("../../tests/fixtures/m2/classification.json", import.meta.url), "utf8"));
const expected = [
  { name: ".sample-public", health: "green", status: "open", primaries: 1, replicas: 0, docsCount: 0, storeBytes: 0 },
  { name: "sample-a", health: "green", status: "open", primaries: 1, replicas: 1, docsCount: 42, storeBytes: 2048 },
  { name: "sample-closed", health: null, status: "close", primaries: null, replicas: null, docsCount: null, storeBytes: null },
  { name: "sample-z", health: "yellow", status: "open", primaries: 2, replicas: 1, docsCount: 1200, storeBytes: 1572864 },
];

async function setup(t: test.TestContext) {
  const fixture = await createCliFixture(t, { applicationId: "opensearch-cli", profiles: [
    { name: "default", values: { url: origin + "/search/", auth: "none" } },
  ] });
  const server = setupServer();
  server.listen({ onUnhandledFrame: "error" });
  t.after(() => server.close());
  const app = fixture.createApplication(runtime => createCli({ ...createDefinition(), runtime }));
  const requests: URL[] = [];
  server.use(http.get(origin + "/search/_cat/indices/:pattern", ({ request }) => {
    const url = new URL(request.url);
    requests.push(url);
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(url.searchParams.get("format"), "json");
    assert.equal(url.searchParams.get("bytes"), "b");
    assert.equal(url.searchParams.get("h"), "index,health,status,pri,rep,docs.count,store.size");
    assert.equal(url.searchParams.get("allow_no_indices"), "true");
    return HttpResponse.json(rows);
  }), http.get(origin + "/search/_cluster/state/metadata/:pattern", ({ request }) => {
    const url = new URL(request.url);
    requests.push(url);
    assert.equal(url.searchParams.get("filter_path"), "metadata.indices.*.system,metadata.indices.*.settings.index.hidden");
    assert.equal(url.searchParams.get("expand_wildcards"), "all");
    return HttpResponse.json(classification);
  }));
  return { fixture, app, server, requests };
}

// Story4: supported CLI, execute and RPC, with both REST boundaries mocked at native fetch.
test("indices list shows sorted names, health, status, shard counts and human byte sizes", async t => {
  const { fixture, app, requests } = await setup(t);
  const result = await fixture.run(app, ["indices", "list"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  const lines = result.stdout.trim().split("\n");
  assert.match(lines[0]!, /Name\s+Health\s+Status\s+Primaries\s+Replicas\s+Docs\s+Store/);
  assert.deepEqual(lines.slice(1).map(line => line.trim().split(/\s+/)[0]), expected.map(row => row.name));
  assert.match(lines.at(-1)!, /sample-z\s+yellow\s+open\s+2\s+1\s+1200\s+1.5 MiB/);
  assert.equal(requests[0]!.searchParams.get("expand_wildcards"), "open,closed");
});

test("indices list returns identical typed domain values through JSON, execute and RPC", async t => {
  const { fixture, app } = await setup(t);
  assert.deepEqual(await fixture.json(app, ["indices", "list"]), expected);
  assert.deepEqual(await app.execute(["indices", "list"]), expected);
  const [reply] = await fixture.rpc(app, [["indices", "list"]]) as { result: unknown }[];
  assert.deepEqual(reply!.result, expected);
});

test("indices list preserves the pattern and health filter in its request", async t => {
  const { fixture, app, server, requests } = await setup(t);
  server.use(http.get(origin + "/search/_cat/indices/:pattern", ({ request, params }) => {
    const url = new URL(request.url);
    requests.push(url);
    assert.equal(params.pattern, "sample-*");
    assert.equal(url.searchParams.get("health"), "yellow");
    return HttpResponse.json([rows[0]]);
  }));
  assert.deepEqual(await fixture.json(app, ["indices", "list", "sample-*", "--health", "yellow"]), [expected[3]]);
  assert.equal(decodeURIComponent(requests[1]!.pathname), "/search/_cluster/state/metadata/sample-*");
});

test("indices list treats unmatched patterns as a successful empty result", async t => {
  const { fixture, app, server, requests } = await setup(t);
  server.use(http.get(origin + "/search/_cat/indices/:pattern", ({ request, params }) => {
    assert.equal(params.pattern, "absent-*");
    assert.equal(new URL(request.url).searchParams.get("allow_no_indices"), "true");
    return HttpResponse.json([]);
  }));
  const result = await fixture.run(app, ["indices", "list", "absent-*"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), "No indices found.");
  assert.deepEqual(await fixture.json(app, ["indices", "list", "absent-*"]), []);
  assert.equal(requests.length, 0, "Empty results need no metadata read");
});

for (const name of ["sample-hidden", "sample-system"]) test(`indices list excludes explicit ${name} without the opt-in`, async t => {
  const { fixture, app, server } = await setup(t);
  server.use(http.get(origin + "/search/_cat/indices/:pattern", () => HttpResponse.json(rows.filter(row => row.index === name))));
  assert.deepEqual(await fixture.json(app, ["indices", "list", name]), []);
});

test("indices list includes hidden and system rows with the opt-in", async t => {
  const { fixture, app, requests } = await setup(t);
  const value = await fixture.json(app, ["indices", "list", "--include-hidden"]) as { name: string; storeBytes: number | null }[];
  assert.deepEqual(value.map(row => row.name), [".sample-public", "sample-a", "sample-closed", "sample-hidden", "sample-system", "sample-z"]);
  assert.equal(value.find(row => row.name === "sample-hidden")!.storeBytes, 512);
  assert.equal(requests.length, 1, "Inclusion needs no classification read");
  assert.equal(requests[0]!.searchParams.get("expand_wildcards"), "all");
});
