import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { origin, setupExplore } from "./explore-fixture.js";

async function file(t: test.TestContext, body: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "opensearch-round3-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "body.json");
  await writeFile(path, JSON.stringify(body));
  return path;
}

test("bug619 node failure headers retain identities and safe diagnostics on all surfaces", async (t) => {
  // WHAT: review617 reproduced credentials in native _nodes.failures.
  // HOW: a node-stat response retains partial counts/identity/metrics while all entrypoints mask diagnostics.
  const { fixture, server, app } = await setupExplore(t);
  const secret = "synthetic-node-secret";
  const wire = {
    _nodes: {
      total: 2,
      successful: 1,
      failed: 1,
      failures: [
        {
          node_id: "node-b",
          type: "failed_node_exception",
          reason: `Synthetic node token=${secret}`,
          caused_by: {
            type: "synthetic_exception",
            reason: `Synthetic nested password=${secret}`,
          },
        },
      ],
    },
    nodes: {
      "node-a": {
        name: "sample-node",
        jvm: { mem: { heap_used_percent: 12 } },
      },
    },
  };
  server.use(
    http.get(origin + "/search/_nodes/node-a/stats/jvm", () =>
      HttpResponse.json(wire),
    ),
  );
  const argv = ["nodes", "stats", "node-a", "--metric", "jvm"];
  for (const value of [
    await fixture.json(app, argv),
    await app.execute(argv),
    await fixture.rpc(app, [argv]),
    await fixture.run(app, argv),
  ])
    assert.ok(!JSON.stringify(value).includes(secret));
  const value = (await fixture.json(app, argv)) as any;
  assert.equal(value._nodes.failed, 1);
  assert.equal(value._nodes.failures[0].node_id, "node-b");
  assert.equal(value.nodes["node-a"].jvm.mem.heap_used_percent, 12);
});

test("bug620 validation preserves safe native shard failure headers", async (t) => {
  // WHAT: review617 reproduced a diagnostic leak through native BroadcastResponse shard failures.
  // HOW: query validation retains shard identity/counts and masks reason chains on every returned surface.
  const { fixture, server, app } = await setupExplore(t);
  const path = await file(t, { query: { match_all: {} } });
  const secret = "synthetic-validation-shard-secret";
  server.use(
    http.post(origin + "/search/sample-a/_validate/query", () =>
      HttpResponse.json({
        valid: true,
        _shards: {
          total: 2,
          successful: 1,
          failed: 1,
          failures: [
            {
              index: "sample-a",
              shard: 0,
              status: "SERVICE_UNAVAILABLE",
              reason: {
                type: "synthetic_exception",
                reason: `Synthetic shard token=${secret}`,
              },
            },
          ],
        },
        explanations: [],
      }),
    ),
  );
  const argv = ["query", "validate", "sample-a", "--body-file", path];
  for (const value of [
    await fixture.json(app, argv),
    await app.execute(argv),
    await fixture.rpc(app, [argv]),
  ])
    assert.ok(!JSON.stringify(value).includes(secret));
  const value = (await fixture.json(app, argv)) as any;
  assert.equal(value.valid, true);
  assert.equal(value._shards.failed, 1);
  assert.equal(value._shards.failures[0].index, "sample-a");
  const human = await fixture.run(app, argv);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /Synthetic shard/);
  assert.ok(!human.stdout.includes(secret));
});

test("bug621 document writes retain safe native replica diagnostics and version metadata", async (t) => {
  // WHAT: review618 reproduced credentials in ReplicationResponse _shards.failures[].reason.
  // HOW: an index write remains a successful primary write, retaining its metadata and safe replica outcome.
  const { fixture, server, app } = await setupExplore(t);
  await app.execute(["permissions", "grant", "Update"]);
  const path = await file(t, { title: "Synthetic" });
  const secret = "synthetic-replica-secret";
  const wire = {
    _index: "sample-a",
    _id: "a",
    _version: 1,
    _seq_no: 0,
    _primary_term: 1,
    result: "created",
    _shards: {
      total: 2,
      successful: 1,
      failed: 1,
      failures: [
        {
          _index: "sample-a",
          _shard: 0,
          _node: "node-b",
          status: "SERVICE_UNAVAILABLE",
          primary: false,
          reason: {
            type: "synthetic_exception",
            reason: `Synthetic replica token=${secret}`,
          },
        },
      ],
    },
  };
  server.use(
    http.put(origin + "/search/sample-a/_doc/a", () =>
      HttpResponse.json(wire, { status: 201 }),
    ),
  );
  const argv = ["docs", "index", "sample-a", "a", "--body-file", path];
  for (const value of [
    await fixture.json(app, argv),
    await app.execute(argv),
    await fixture.rpc(app, [argv]),
  ])
    assert.ok(!JSON.stringify(value).includes(secret));
  const value = (await fixture.json(app, argv)) as any;
  assert.equal(value.result, "created");
  assert.equal(value._seq_no, 0);
  assert.equal(value._shards.failures[0]._node, "node-b");
  const human = await fixture.run(app, argv);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /Synthetic replica/);
  assert.ok(!human.stdout.includes(secret));
});

test("bug622 native409 and408 by-query responses retain safe complete operation results", async (t) => {
  // WHAT: review618 reproduced operation counts disappearing with native failure HTTP statuses.
  // HOW: both commands retain 409 conflicts and 408 timeouts on CLI/execute/RPC; ordinary403 stays an HTTP error.
  const { fixture, server, app } = await setupExplore(t);
  await app.execute(["permissions", "grant", "Update"]);
  await app.execute(["permissions", "grant", "Delete"]);
  const secret = "synthetic-native-failure-secret";
  let status = 409;
  const response = () => ({
    took: 2,
    total: 3,
    created: 2,
    updated: 0,
    deleted: 2,
    version_conflicts: 1,
    timed_out: status === 408,
    failures:
      status === 408
        ? []
        : [
            {
              index: "sample-a",
              id: "a",
              status: 409,
              cause: {
                type: "version_conflict_engine_exception",
                reason: `Synthetic conflict token=${secret}`,
              },
            },
          ],
  });
  const handler = () => HttpResponse.json(response(), { status });
  server.use(
    http.post(origin + "/search/_reindex", handler),
    http.post(origin + "/search/sample-a/_delete_by_query", handler),
  );
  for (const argv of [
    ["reindex", "--source", "sample-a", "--dest", "sample-b", "--wait"],
    ["docs", "delete-by-query", "sample-a", "--q", "title:example", "--wait"],
  ])
    for (status of [409, 408]) {
      const json = await fixture.run(app, [...argv, "--json"]);
      assert.equal(json.exitCode, 1);
      assert.equal(JSON.parse(json.stderr).error.code, "operation.partial");
      const result = JSON.parse(json.stdout);
      assert.equal(result.total, 3);
      assert.equal(result.created, 2);
      assert.equal(result.deleted, 2);
      assert.equal(result.timed_out, status === 408);
      assert.ok(!JSON.stringify(json).includes(secret));
      const human = await fixture.run(app, argv);
      assert.equal(human.exitCode, 1);
      assert.match(human.stdout, /total/i);
      assert.ok(!JSON.stringify(human).includes(secret));
      const [reply] = (await fixture.rpc(app, [argv])) as any[];
      assert.equal(reply.error.data.code, "operation.partial");
      assert.equal(reply.error.data.result.total, 3);
      assert.ok(!JSON.stringify(reply).includes(secret));
      await assert.rejects(app.execute(argv), (error: any) => {
        assert.equal(error.code, "operation.partial");
        assert.equal(error.result.total, 3);
        assert.ok(!JSON.stringify(error.result).includes(secret));
        return true;
      });
    }
  server.use(
    http.post(origin + "/search/_reindex", () =>
      HttpResponse.json(
        {
          error: { type: "security_exception", reason: "Synthetic denied" },
          status: 403,
        },
        { status: 403 },
      ),
    ),
  );
  const denied = await fixture.run(app, [
    "reindex",
    "--source",
    "sample-a",
    "--dest",
    "sample-b",
    "--wait",
    "--json",
  ]);
  assert.equal(JSON.parse(denied.stderr).error.code, "http.forbidden");
  assert.equal(denied.stdout, "");
});

test("bug623 human observations show instants while machine timestamps stay numeric", async (t) => {
  // WHAT: actual command probes showed raw epoch milliseconds in node/task human records.
  // HOW: native observation and task-start timestamps become ISO instants only in human views.
  const { fixture, server, app } = await setupExplore(t);
  await app.execute(["permissions", "grant", "Update"]);
  const timestamp = 1700000000000;
  const task = {
    node: "node-a",
    id: 7,
    start_time_in_millis: timestamp,
    action: "indices:data/read/search",
    running_time_in_nanos: 1000,
    cancellable: true,
  };
  server.use(
    http.get(origin + "/search/_nodes/node-a/stats/jvm", () =>
      HttpResponse.json({
        _nodes: { total: 1, successful: 1, failed: 0 },
        nodes: {
          "node-a": {
            timestamp,
            jvm: { timestamp, mem: { heap_used_percent: 12 } },
          },
        },
      }),
    ),
    http.get(origin + "/search/_tasks/node-a:7", () =>
      HttpResponse.json({ completed: false, task }),
    ),
    http.post(origin + "/search/_tasks/node-a:7/_cancel", () =>
      HttpResponse.json({
        nodes: { "node-a": { tasks: { "node-a:7": task } } },
      }),
    ),
  );
  for (const argv of [
    ["nodes", "stats", "node-a", "--metric", "jvm"],
    ["tasks", "show", "node-a:7"],
    ["tasks", "cancel", "node-a:7"],
  ]) {
    const human = await fixture.run(app, argv);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /2023-11-14T22:13:20.000Z/);
    assert.ok(!human.stdout.includes(String(timestamp)));
  }
  assert.equal(
    (
      (await fixture.json(app, [
        "nodes",
        "stats",
        "node-a",
        "--metric",
        "jvm",
      ])) as any
    ).nodes["node-a"].timestamp,
    timestamp,
  );
  const [reply] = (await fixture.rpc(app, [
    ["tasks", "show", "node-a:7"],
  ])) as any[];
  assert.equal(reply.result.task.start_time_in_millis, timestamp);
});
