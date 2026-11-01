import assert from "node:assert/strict";
import test from "node:test";
import { Writable } from "node:stream";
import { http, HttpResponse } from "msw";
import { origin, setupExplore } from "./explore-fixture.js";

// Synthetic OpenSearch2.19/3.2/3.3 PIT/Search API shapes; documentation-derived, no captures.
const shards = { total: 1, successful: 1, failed: 0 };
const hits = (ids: number[]) => ids.map(id => ({ _index: "sample-a", _id: `doc-${id}`, _source: { title: `Synthetic ${id}` }, sort: [id] }));
const page = (ids: number[]) => ({ took: 1, timed_out: false, _shards: shards, hits: { total: { value: 10000, relation: "gte" }, hits: hits(ids) } });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function setup(t: test.TestContext, version = "3.3.0") {
  const f = await setupExplore(t);
  const state = { opened: 0, closed: 0, pages: 0, order: [] as string[] };
  f.server.use(
    http.get(origin + "/search/", () => HttpResponse.json({ name: "sample-node", cluster_name: "sample", cluster_uuid: "sample-uuid", version: { distribution: "opensearch", number: version } })),
    http.post(origin + "/search/sample-a/_search/point_in_time", ({ request }) => {
      const query = new URL(request.url).searchParams;
      assert.equal(query.get("keep_alive"), "1m");
      assert.equal(query.get("allow_partial_pit_creation"), "false");
      state.opened++; state.order.push("open");
      return HttpResponse.json({ pit_id: "sample-pit", _shards: shards, creation_time: 1 });
    }),
    http.delete(origin + "/search/_search/point_in_time", async ({ request }) => {
      assert.deepEqual(await request.json(), { pit_id: ["sample-pit"] });
      assert.equal(request.signal.aborted, false, "Cleanup has a fresh signal.");
      state.closed++; state.order.push("close");
      return HttpResponse.json({ pits: [{ pit_id: "sample-pit", successful: true }] });
    }),
  );
  return { ...f, state };
}

test("Story37 streams hits incrementally with PIT/search_after then closes the PIT", { timeout: 5000 }, async t => {
  const { fixture, server, app, state } = await setup(t);
  const secondPage = deferred(), release = deferred();
  let stdout = "";
  const output = new Writable({ write(chunk, _encoding, done) { stdout += chunk.toString(); done(); } });
  server.use(http.post(origin + "/search/_search", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    state.pages++;
    assert.deepEqual(body.pit, { id: "sample-pit", keep_alive: "1m" });
    assert.deepEqual(body.sort, [{ _shard_doc: { order: "asc" } }]);
    if (state.pages === 1) {
      assert.equal(body.size, 2); assert.equal(body.search_after, undefined);
      return HttpResponse.json(page([1, 2]));
    }
    assert.equal(body.size, 2); assert.deepEqual(body.search_after, [2]);
    secondPage.resolve(); await release.promise;
    return HttpResponse.json(page([3]));
  }));
  const running = fixture.run(app, ["search", "sample-a", "--all", "--max-results", "4", "--size", "2", "--json"], { output });
  try {
    await Promise.race([secondPage.promise, running.then(() => { throw Error("Command finished before paging."); })]);
    assert.deepEqual(stdout.trim().split("\n").map(line => JSON.parse(line)), hits([1, 2]));
    assert.equal(state.closed, 0);
  } finally { release.resolve(); }
  const result = await running;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(stdout.trim().split("\n").map(line => JSON.parse(line)), hits([1, 2, 3]));
  assert.deepEqual([state.opened, state.pages, state.closed], [1, 2, 1]);
  assert.equal(output.writableEnded, false);
});

test("Story37 exact budget checks one extra hit and reports only yielded documents", async t => {
  const { fixture, server, app, state } = await setup(t);
  let overflow = true;
  server.use(http.post(origin + "/search/_search", async ({ request }) => {
    const body = await request.json() as { size: number; search_after?: number[] };
    if (!body.search_after) { assert.equal(body.size, 2); return HttpResponse.json(page([1, 2])); }
    assert.deepEqual(body.search_after, [2]); assert.equal(body.size, 1);
    return HttpResponse.json(page(overflow ? [3] : []));
  }));
  const argv = ["search", "sample-a", "--all", "--max-results", "2", "--size", "2"];
  const failed = await fixture.run(app, [...argv, "--json"]);
  assert.equal(failed.exitCode, 1);
  assert.deepEqual(failed.stdout.trim().split("\n").map(line => JSON.parse(line)), hits([1, 2]));
  const error = JSON.parse(failed.stderr).error;
  assert.equal(error.code, "search.budgetExceeded");
  assert.deepEqual(error.result, { retrievedCount: 2, observedCount: 3, maxResults: 2 });
  overflow = false;
  assert.deepEqual(await app.execute(argv), hits([1, 2]));
  assert.equal(state.closed, 2);
});

test("Story37 caps a large requested page at remaining budget plus lookahead", async t => {
  const { fixture, server, app } = await setup(t);
  server.use(http.post(origin + "/search/_search", async ({ request }) => {
    assert.equal((await request.json() as {size: number}).size, 2);
    return HttpResponse.json(page([1, 2]));
  }));
  const failed = await fixture.run(app, ["search", "sample-a", "--all", "--max-results", "1", "--size", "1000", "--json"]);
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.stdout, JSON.stringify(hits([1])[0]) + "\n");
  assert.deepEqual(JSON.parse(failed.stderr).error.result, { retrievedCount: 1, observedCount: 2, maxResults: 1 });
});

for (const version of ["2.19.0", "3.2.0"]) test(`Story37 ${version} uses an explicit unique doc-values tie-breaker`, async t => {
  const { fixture, server, app, state } = await setup(t, version);
  server.use(http.post(origin + "/search/_search", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    assert.deepEqual(body.query, { query_string: { query: "category:example" } });
    assert.deepEqual(body._source, ["title"]);
    assert.deepEqual(body.sort, [{ rank: "desc" }, { unique_key: { order: "asc" } }]);
    return HttpResponse.json({ ...page([1]), hits: { ...page([1]).hits, hits: [{ ...hits([1])[0], sort: [9, "sample-1"] }] } });
  }));
  const result = await fixture.run(app, ["search", "sample-a", "--q", "category:example", "--fields", "title", "--sort", "rank:desc", "--all", "--max-results", "3", "--tie-breaker", "unique_key", "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout)._id, "doc-1");
  assert.equal(state.closed, 1);
});

test("Story37 human/execute and successive RPC requests receive hit arrays, including empty", async t => {
  const { fixture, server, app, state } = await setup(t);
  let empty = false;
  server.use(http.post(origin + "/search/_search", () => HttpResponse.json(page(empty ? [] : [1]))));
  const argv = ["search", "sample-a", "--all", "--max-results", "3"];
  const human = await fixture.run(app, argv);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /doc-1/); assert.match(human.stdout, /Synthetic 1/);
  assert.deepEqual(await app.execute(argv), hits([1]));
  const replies = await fixture.rpc(app, [[...argv, "--json"], argv]) as { result: unknown }[];
  assert.deepEqual(replies.map(reply => reply.result), [hits([1]), hits([1])]);
  empty = true;
  const json = await fixture.run(app, [...argv, "--json"]);
  assert.equal(json.exitCode, 0, json.stderr); assert.equal(json.stdout, "");
  assert.deepEqual(await app.execute(argv), []);
  assert.equal(state.opened, state.closed);
});

test("Story37 requires an explicit budget and permission before PIT acquisition", async t => {
  const { fixture, app, state } = await setup(t);
  const missing = await fixture.run(app, ["search", "sample-a", "--all", "--json"]);
  assert.equal(missing.exitCode, 1);
  assert.equal(JSON.parse(missing.stderr).error.code, "usage");
  await app.execute(["permissions", "revoke", "ReadOnly"]);
  const denied = await fixture.run(app, ["search", "sample-a", "--all", "--max-results", "3", "--json"]);
  assert.equal(JSON.parse(denied.stderr).error.code, "permission.denied");
  assert.equal(state.opened, 0);
});

test("Story37 old versions and unavailable PITs fail clearly without unstable fallback", async t => {
  const { fixture, server, app, state } = await setup(t, "2.3.0");
  const argv = ["search", "sample-a", "--all", "--max-results", "3", "--tie-breaker", "unique_key", "--json"];
  const old = await fixture.run(app, argv);
  assert.equal(JSON.parse(old.stderr).error.code, "search.pitUnavailable");
  assert.equal(state.opened, 0);
  server.use(
    http.get(origin + "/search/", () => HttpResponse.json({ cluster_name: "sample", cluster_uuid: "sample-uuid", version: { distribution: "opensearch", number: "2.19.0" } })),
    http.post(origin + "/search/sample-a/_search/point_in_time", () => HttpResponse.json({error:{type:"illegal_argument_exception",reason:"Synthetic PIT disabled"}}, {status:400})),
  );
  const disabled = await fixture.run(app, argv);
  assert.equal(JSON.parse(disabled.stderr).error.code, "search.pitUnavailable");
  assert.equal(state.closed, 0);
});

for (const mode of ["interrupt", "disconnect"] as const) test(`Story37 ${mode} aborts an active page and deletes PIT with a fresh signal`, { timeout: 5000 }, async t => {
  const { fixture, server, app, state } = await setup(t);
  const pending = deferred(), aborted = deferred();
  const interrupt = new AbortController();
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  server.use(http.post(origin + "/search/_search", async ({ request }) => {
    const body = await request.json() as { search_after?: unknown };
    if (!body.search_after) return HttpResponse.json(page([1]));
    pending.resolve();
    await new Promise<void>(resolve => request.signal.addEventListener("abort", () => { aborted.resolve(); resolve(); }, { once: true }));
    return HttpResponse.json(page([]));
  }));
  const running = fixture.run(app, ["search", "sample-a", "--all", "--max-results", "3", "--size", "1", "--json"], { output, signal: interrupt.signal });
  await Promise.race([pending.promise, running.then(() => { throw Error("Command finished before a pending page."); })]);
  if (mode === "interrupt") interrupt.abort(); else output.destroy();
  const result = await running;
  await aborted.promise;
  assert.equal(result.exitCode, mode === "interrupt" ? 130 : 1);
  assert.equal(state.closed, 1);
});

test("Story37 partial pages remain explicit and strict failures keep count metadata", async t => {
  const { fixture, server, app, state } = await setup(t);
  server.use(http.post(origin + "/search/_search", () => HttpResponse.json({ ...page([1]), timed_out: true })));
  const argv = ["search", "sample-a", "--all", "--max-results", "3", "--json"];
  const partial = await fixture.run(app, argv);
  assert.equal(partial.exitCode, 0, partial.stderr);
  assert.match(partial.stderr, /timed out/i);
  const failed = await fixture.run(app, [...argv, "--fail-on-partial"]);
  assert.equal(failed.exitCode, 1); assert.equal(failed.stdout, "");
  const error = JSON.parse(failed.stderr).error;
  assert.equal(error.code, "search.partial");
  assert.equal(error.result.retrievedCount, 0); assert.equal(error.result.observedCount, 1);
  assert.equal(error.result.partial.timedOut, true);
  assert.equal(state.closed, 2);
});

test("Story37 cleanup failure retains the primary budget failure and cleanup diagnostics", async t => {
  const { fixture, server, app } = await setup(t);
  server.use(
    http.post(origin + "/search/_search", () => HttpResponse.json(page([1, 2]))),
    http.delete(origin + "/search/_search/point_in_time", () => HttpResponse.json({ pits: [{ pit_id: "sample-pit", successful: false }] })),
  );
  const result = await fixture.run(app, ["search", "sample-a", "--all", "--max-results", "1", "--json"]);
  assert.equal(result.exitCode, 1);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, "search.budgetExceeded");
  assert.equal(error.result.cleanupFailed, true);
  assert.match(JSON.stringify(error.cause), /cleanup/i);
});
