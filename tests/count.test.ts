import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { http, HttpResponse } from "msw";
import { origin, setupExplore } from "./explore-fixture.js";

// Synthetic Count2.19/3.2: no terminate_after is requested; failures remain observable.
const complete = { count: 42, _shards: { total: 2, successful: 2, skipped: 0, failed: 0 } };
const expected = { ...complete, partial: { failedShards: 0, totalShards: 2, failures: [] } };
test("M2 count returns an exact count and shared JSON/RPC domain value", async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.get(origin + "/search/:pattern/_count", ({ request, params }) => {
    assert.equal(params.pattern, "sample-*"); assert.equal(new URL(request.url).search, "");
    return HttpResponse.json(complete);
  }));
  assert.deepEqual(await fixture.json(app, ["count", "sample-*"]), expected);
  const human = await fixture.run(app, ["count", "sample-*"]);
  assert.equal(human.exitCode, 0, human.stderr); assert.match(human.stdout, /Count:\s+42/); assert.equal(human.stderr, "");
  const [reply] = await fixture.rpc(app, [["count", "sample-*"]]) as { result: unknown }[];
  assert.deepEqual(reply!.result, expected);
});
test("M2 count passes the query string without altering it", async t => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(http.get(origin + "/search/sample-a/_count", ({ request }) => {
    assert.equal(new URL(request.url).searchParams.get("q"), "status:500 AND user:sample");
    return HttpResponse.json(complete);
  }));
  assert.deepEqual(await fixture.json(app, ["count", "sample-a", "--q", "status:500 AND user:sample"]), expected);
});
for (const source of ["file", "stdin"]) test(`M2 count reads a Query DSL query object from ${source}`, async t => {
  const { fixture, server, app } = await setupExplore(t);
  const query = { term: { status: 500 } };
  const directory = await mkdtemp(join(tmpdir(), "opensearch-count-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "query.json"), JSON.stringify(query));
  server.use(http.post(origin + "/search/sample-a/_count", async ({ request }) => {
    assert.deepEqual(await request.json(), { query });
    assert.match(request.headers.get("content-type")!, /application\/json/);
    return HttpResponse.json(complete);
  }));
  const result = await fixture.run(app, ["count", "sample-a", "--query-file", source === "file" ? "query.json" : "-", "--json"], {
    cwd: directory, ...(source === "stdin" ? { input: Readable.from([JSON.stringify(query)]) } : {}),
  });
  assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), expected);
});
test("M2 count preserves shard failures, warns humans and can fail with its result", async t => {
  const { fixture, server, app } = await setupExplore(t);
  const failures = [{ shard: 1, index: "sample-a", reason: { type: "query_shard_exception", reason: "synthetic shard unavailable" } }];
  const partial = { count: 12, _shards: { total: 2, successful: 1, skipped: 0, failed: 1, failures } };
  const value = { ...partial, partial: { failedShards: 1, totalShards: 2, failures } };
  server.use(http.get(origin + "/search/sample-a/_count", () => HttpResponse.json(partial)));
  assert.deepEqual(await fixture.json(app, ["count", "sample-a"]), value);
  const human = await fixture.run(app, ["count", "sample-a"]);
  assert.equal(human.exitCode, 0, human.stderr); assert.match(human.stdout, /Count:\s+12/);
  assert.match(human.stderr, /1\/2 shards failed/); assert.match(human.stderr, /synthetic shard unavailable/);
  const strict = await fixture.run(app, ["count", "sample-a", "--fail-on-partial", "--json"]);
  assert.notEqual(strict.exitCode, 0); assert.deepEqual(JSON.parse(strict.stdout), value);
  assert.equal(JSON.parse(strict.stderr).error.code, "search.partial");
});
