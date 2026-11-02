import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { origin, setupExplore } from "./explore-fixture.js";

// Documentation-derived OpenSearch 2.19/3.x wire shapes; all data is synthetic.
async function bodyFile(t: test.TestContext, body: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "opensearch-diagnose-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "body.json");
  await writeFile(path, JSON.stringify(body));
  return path;
}

test("Story15 validates valid and invalid queries as data on JSON, human and RPC", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  const path = await bodyFile(t, { query: { match_all: {} } });
  let valid = true;
  server.use(
    http.post(
      origin + "/search/sample-a/_validate/query",
      async ({ request }) => {
        assert.deepEqual(await request.json(), { query: { match_all: {} } });
        assert.equal(new URL(request.url).searchParams.get("explain"), "true");
        return HttpResponse.json({
          valid,
          explanations: [
            {
              index: "sample-a",
              valid,
              ...(valid
                ? { explanation: "*:*" }
                : { error: "Synthetic parsing error" }),
            },
          ],
        });
      },
    ),
  );
  const argv = [
    "query",
    "validate",
    "sample-a",
    "--body-file",
    path,
    "--explain",
  ];
  assert.equal(((await fixture.json(app, argv)) as any).valid, true);
  valid = false;
  const human = await fixture.run(app, argv);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /false/);
  assert.match(human.stdout, /Synthetic parsing error/);
  const [reply] = (await fixture.rpc(app, [argv])) as any[];
  assert.equal(reply.result.valid, false);
});

test("Story15 document explain preserves match and nested score explanation", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  const path = await bodyFile(t, { query: { term: { title: "example" } } });
  let matched = true;
  server.use(
    http.post(
      origin + "/search/sample-a/_explain/doc-1",
      async ({ request }) => {
        assert.deepEqual(await request.json(), {
          query: { term: { title: "example" } },
        });
        return HttpResponse.json({
          _index: "sample-a",
          _id: "doc-1",
          matched,
          explanation: {
            value: 1,
            description: "Synthetic score",
            details: [{ value: 1, description: "term match", details: [] }],
          },
        });
      },
    ),
  );
  const argv = ["query", "explain", "sample-a", "doc-1", "--body-file", path];
  assert.equal(((await fixture.json(app, argv)) as any).matched, true);
  matched = false;
  const human = await fixture.run(app, argv);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /false/);
  assert.match(human.stdout, /term match/);
});

test("Story16 analyzes text through analyzer and mapped-field paths", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  const wire = {
    tokens: [
      {
        token: "quick",
        start_offset: 0,
        end_offset: 5,
        type: "<ALPHANUM>",
        position: 0,
      },
    ],
  };
  server.use(
    http.post(origin + "/search/_analyze", async ({ request }) => {
      assert.deepEqual(await request.json(), {
        analyzer: "standard",
        text: "Quick",
      });
      return HttpResponse.json(wire);
    }),
    http.post(origin + "/search/sample-a/_analyze", async ({ request }) => {
      assert.deepEqual(await request.json(), { field: "title", text: "Quick" });
      return HttpResponse.json(wire);
    }),
  );
  assert.deepEqual(
    await fixture.json(app, ["analyze", "--analyzer", "standard", "Quick"]),
    wire,
  );
  const argv = ["analyze", "--index", "sample-a", "--field", "title", "Quick"];
  const human = await fixture.run(app, argv);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /quick/);
  assert.match(human.stdout, /Position/);
  const [reply] = (await fixture.rpc(app, [argv])) as any[];
  assert.deepEqual(reply.result, wire);
});

test("Story16 unknown analyzer keeps the safe server cause", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(
    http.post(origin + "/search/_analyze", () =>
      HttpResponse.json(
        {
          error: {
            type: "illegal_argument_exception",
            reason: "Synthetic analyzer is unavailable",
          },
          status: 400,
        },
        { status: 400 },
      ),
    ),
  );
  const run = await fixture.run(app, [
    "analyze",
    "--analyzer",
    "missing",
    "text",
    "--json",
  ]);
  assert.equal(run.exitCode, 1);
  assert.equal(JSON.parse(run.stderr).error.code, "analysis.invalid");
  assert.match(run.stderr, /Synthetic analyzer/);
});

test("Story17 lists numeric resource observations joined to full node roles", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(
    http.get(origin + "/search/_cat/nodes", ({ request }) => {
      const query = new URL(request.url).searchParams;
      assert.equal(query.get("format"), "json");
      assert.equal(query.get("bytes"), "b");
      assert.equal(query.get("full_id"), "true");
      return HttpResponse.json([
        {
          id: "node-a",
          name: "sample-node",
          cluster_manager: "*",
          "heap.percent": "12",
          "ram.percent": "34",
          cpu: "5",
          load_1m: "0.25",
          "disk.used": "1024",
          "disk.avail": "4096",
          "disk.total": "5120",
        },
      ]);
    }),
    http.get(origin + "/search/_nodes", () =>
      HttpResponse.json({
        nodes: {
          "node-a": { name: "sample-node", roles: ["data", "cluster_manager"] },
        },
      }),
    ),
  );
  const expected = [
    {
      id: "node-a",
      name: "sample-node",
      roles: ["data", "cluster_manager"],
      clusterManager: true,
      heapPercent: 12,
      ramPercent: 34,
      cpuPercent: 5,
      load1m: 0.25,
      diskUsedBytes: 1024,
      diskAvailableBytes: 4096,
      diskTotalBytes: 5120,
    },
  ];
  assert.deepEqual(await fixture.json(app, ["nodes", "list"]), expected);
  const human = await fixture.run(app, ["nodes", "list"]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /sample-node/);
  assert.match(human.stdout, /KiB/);
});

test("Story17 selected node stats preserve numeric per-node metrics on RPC", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  const wire = {
    _nodes: { total: 1, successful: 1, failed: 0 },
    nodes: {
      "node-a": {
        name: "sample-node",
        jvm: { mem: { heap_used_percent: 12 } },
        fs: { total: { total_in_bytes: 5120 } },
        os: { cpu: { percent: 5 } },
      },
    },
  };
  server.use(
    http.get(origin + "/search/_nodes/node-a/stats/jvm,fs,os", () =>
      HttpResponse.json(wire),
    ),
  );
  const [reply] = (await fixture.rpc(app, [
    ["nodes", "stats", "node-a", "--metric", "jvm,fs,os"],
  ])) as any[];
  assert.deepEqual(reply.result, wire);
});

test("Story18 filters unassigned shards and explains default and selected shards", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  let selected = false;
  server.use(
    http.get(origin + "/search/_cat/shards/sample-a", () =>
      HttpResponse.json([
        {
          index: "sample-a",
          shard: "0",
          prirep: "r",
          state: "UNASSIGNED",
          "unassigned.reason": "INDEX_CREATED",
        },
        {
          index: "sample-a",
          shard: "0",
          prirep: "p",
          state: "STARTED",
          "unassigned.reason": null,
        },
      ]),
    ),
    http.post(
      origin + "/search/_cluster/allocation/explain",
      async ({ request }) => {
        assert.deepEqual(
          await request.json(),
          selected ? { index: "sample-a", shard: 0, primary: true } : {},
        );
        return HttpResponse.json({
          index: "sample-a",
          shard: 0,
          primary: selected,
          current_state: "unassigned",
          can_allocate: "no",
          allocate_explanation: "Synthetic disk decision",
        });
      },
    ),
  );
  assert.deepEqual(
    await fixture.json(app, [
      "shards",
      "list",
      "sample-a",
      "--state",
      "unassigned",
    ]),
    [
      {
        index: "sample-a",
        shard: 0,
        primary: false,
        state: "UNASSIGNED",
        unassignedReason: "INDEX_CREATED",
      },
    ],
  );
  const human = await fixture.run(app, ["shards", "explain"]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /Synthetic disk decision/);
  selected = true;
  assert.equal(
    (
      (await fixture.json(app, [
        "shards",
        "explain",
        "--index",
        "sample-a",
        "--shard",
        "0",
        "--primary",
      ])) as any
    ).primary,
    true,
  );
});

test("Story18 no unassigned shard is a clear successful observation", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  server.use(
    http.post(origin + "/search/_cluster/allocation/explain", () =>
      HttpResponse.json(
        {
          error: {
            type: "illegal_argument_exception",
            reason: "unable to find any unassigned shards to explain",
          },
          status: 400,
        },
        { status: 400 },
      ),
    ),
  );
  const run = await fixture.run(app, ["shards", "explain"]);
  assert.equal(run.exitCode, 0, run.stderr);
  assert.match(run.stdout, /No unassigned shards/);
  assert.deepEqual(await fixture.json(app, ["shards", "explain"]), {
    unassigned: false,
  });
});

test("Story19 lists tasks and retains completed results and errors", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  const task = {
    node: "node-a",
    id: 7,
    action: "indices:data/read/search",
    running_time_in_nanos: 1500000,
    cancellable: true,
  };
  server.use(
    http.get(origin + "/search/_tasks", ({ request }) => {
      const q = new URL(request.url).searchParams;
      assert.equal(q.get("actions"), "*search*");
      assert.equal(q.get("detailed"), "true");
      assert.equal(q.get("group_by"), "none");
      return HttpResponse.json({ tasks: [task] });
    }),
    http.get(origin + "/search/_tasks/node-a:7", () =>
      HttpResponse.json({ completed: true, task, response: { total: 3 } }),
    ),
  );
  const argv = ["tasks", "list", "--actions", "*search*", "--detailed"];
  assert.deepEqual(await fixture.json(app, argv), { tasks: [task] });
  const human = await fixture.run(app, argv);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /node-a:7/);
  assert.match(human.stdout, /search/);
  const [reply] = (await fixture.rpc(app, [
    ["tasks", "show", "node-a:7"],
  ])) as any[];
  assert.equal(reply.result.completed, true);
  assert.deepEqual(reply.result.response, { total: 3 });
  server.use(
    http.get(origin + "/search/_tasks/node-a:7", () =>
      HttpResponse.json({
        completed: true,
        task,
        error: {
          type: "synthetic_exception",
          reason: "Synthetic task failure",
        },
      }),
    ),
  );
  assert.equal(
    ((await fixture.json(app, ["tasks", "show", "node-a:7"])) as any).error
      .reason,
    "Synthetic task failure",
  );
});

test("Story19 cancel gates before HTTP and reports cancellation response", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  let calls = 0;
  server.use(
    http.post(origin + "/search/_tasks/node-a:7/_cancel", () => {
      calls++;
      return HttpResponse.json({
        nodes: { "node-a": { tasks: { "node-a:7": { cancelled: true } } } },
      });
    }),
  );
  const argv = ["tasks", "cancel", "node-a:7"];
  const denied = await fixture.run(app, [...argv, "--json"]);
  assert.equal(denied.exitCode, 1);
  assert.equal(JSON.parse(denied.stderr).error.code, "permission.denied");
  assert.equal(calls, 0);
  await app.execute(["permissions", "grant", "Update"]);
  assert.ok(
    ((await fixture.json(app, argv)) as any).nodes["node-a"].tasks["node-a:7"]
      .cancelled,
  );
  assert.equal(calls, 1);
  server.use(
    http.post(origin + "/search/_tasks/node-a:7/_cancel", () =>
      HttpResponse.json(
        {
          error: {
            type: "illegal_argument_exception",
            reason: "Synthetic task does not support cancellation",
          },
          status: 400,
        },
        { status: 400 },
      ),
    ),
  );
  const rejected = await fixture.run(app, [...argv, "--json"]);
  assert.equal(rejected.exitCode, 1);
  assert.match(rejected.stderr, /does not support cancellation/);
  server.use(http.post(origin+"/search/_tasks/node-a:7/_cancel",()=>HttpResponse.json({nodes:{},node_failures:[{type:"failed_node_exception",reason:"Synthetic task does not support cancellation"}]})));
  const nodeFailure=await fixture.run(app,[...argv,"--json"]);
  assert.equal(nodeFailure.exitCode,1);
  assert.equal(JSON.parse(nodeFailure.stderr).error.code,"task.cancelRejected");
  assert.match(nodeFailure.stderr,/does not support cancellation/);
});
