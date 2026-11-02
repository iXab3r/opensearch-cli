import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { origin, setupExplore } from "./explore-fixture.js";
import { createCli } from "@eyeauras/cli-factory";
import { createCliFixture } from "@eyeauras/cli-factory/testing";
import { setupServer } from "msw/node";
import { createDefinition } from "../src/cli.js";

// Synthetic OpenSearch document, bulk, index, task and alias wire contracts.
test("bulk sends the inspected snapshot even when authentication changes the file", async (t) => {
  const original =
    '{"index":{"_index":"sample-a","_id":"a"}}\n{"title":"Synthetic"}\n';
  const path = await inputFile(t, original, true);
  const fixture = await createCliFixture(t, {
    applicationId: "opensearch-cli",
    profiles: [
      {
        name: "default",
        values: { url: origin + "/search/", auth: "basic" },
        permissions: ["ReadOnly", "Update"],
        secrets: {
          basic: JSON.stringify({
            username: "synthetic-operator",
            password: "synthetic-password",
          }),
        },
      },
    ],
  });
  const server = setupServer();
  server.listen({ onUnhandledFrame: "error" });
  t.after(() => server.close());
  let calls = 0;
  server.use(
    http.post(origin + "/search/_bulk", async ({ request }) => {
      calls++;
      assert.equal(await request.text(), original);
      return HttpResponse.json({
        took: 1,
        errors: false,
        items: [{ index: { _id: "a", status: 201 } }],
      });
    }),
  );
  const definition = createDefinition();
  const app = fixture.createApplication((runtime) =>
    createCli({
      ...definition,
      runtime,
      auth: {
        ...definition.auth!,
        isReady: async () => {
          await writeFile(path, '{"delete":{"_index":"sample-a","_id":"b"}}\n');
          return true;
        },
      },
    }),
  );
  assert.equal(
    ((await fixture.json(app, ["bulk", "run", "--file", path])) as any)
      .succeeded,
    1,
  );
  assert.equal(calls, 1);
});
async function inputFile(
  t: test.TestContext,
  content: unknown,
  ndjson = false,
) {
  const dir = await mkdtemp(join(tmpdir(), "opensearch-write-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, ndjson ? "input.ndjson" : "body.json");
  await writeFile(path, ndjson ? String(content) : JSON.stringify(content));
  return path;
}
async function grant(
  app: Awaited<ReturnType<typeof setupExplore>>["app"],
  ...categories: string[]
) {
  for (const c of categories) await app.execute(["permissions", "grant", c]);
}
const document = {
  _index: "sample-a",
  _id: "doc-1",
  _version: 1,
  result: "created",
  _seq_no: 0,
  _primary_term: 1,
  _shards: { total: 1, successful: 1, failed: 0 },
};

test("Story20 document index, create, auto-ID, update and delete preserve results", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  await grant(app, "Update", "Delete");
  const body = await inputFile(t, { title: "Synthetic" });
  const patch = await inputFile(t, { doc: { title: "Updated" } });
  server.use(
    http.put(origin + "/search/sample-a/_doc/doc-1", async ({ request }) => {
      assert.deepEqual(await request.json(), { title: "Synthetic" });
      assert.equal(
        new URL(request.url).searchParams.get("refresh"),
        "wait_for",
      );
      return HttpResponse.json(document);
    }),
    http.post(origin + "/search/sample-a/_doc", () =>
      HttpResponse.json({ ...document, _id: "generated" }),
    ),
    http.put(origin + "/search/sample-a/_create/doc-1", () =>
      HttpResponse.json(document),
    ),
    http.post(
      origin + "/search/sample-a/_update/doc-1",
      async ({ request }) => {
        assert.deepEqual(await request.json(), { doc: { title: "Updated" } });
        return HttpResponse.json({ ...document, result: "noop" });
      },
    ),
    http.delete(origin + "/search/sample-a/_doc/doc-1", () =>
      HttpResponse.json({ ...document, result: "deleted" }),
    ),
  );
  assert.deepEqual(
    await fixture.json(app, [
      "docs",
      "index",
      "sample-a",
      "doc-1",
      "--body-file",
      body,
      "--refresh",
      "wait_for",
    ]),
    document,
  );
  assert.equal(
    (
      (await fixture.json(app, [
        "docs",
        "index",
        "sample-a",
        "--body-file",
        body,
      ])) as any
    )._id,
    "generated",
  );
  assert.equal(
    (
      (await fixture.json(app, [
        "docs",
        "index",
        "sample-a",
        "doc-1",
        "--create",
        "--body-file",
        body,
      ])) as any
    ).result,
    "created",
  );
  const [reply] = (await fixture.rpc(app, [
    ["docs", "update", "sample-a", "doc-1", "--body-file", patch],
  ])) as any[];
  assert.equal(reply.result.result, "noop");
  const human = await fixture.run(app, ["docs", "delete", "sample-a", "doc-1"]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /doc-1/);
  assert.match(human.stdout, /deleted/);
});

test("Story20 optimistic concurrency conflict has a stable document code", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  await grant(app, "Update");
  const body = await inputFile(t, { title: "Synthetic" });
  server.use(
    http.put(origin + "/search/sample-a/_doc/doc-1", ({ request }) => {
      const q = new URL(request.url).searchParams;
      assert.equal(q.get("if_seq_no"), "7");
      assert.equal(q.get("if_primary_term"), "2");
      return HttpResponse.json(
        {
          error: {
            type: "version_conflict_engine_exception",
            reason: "Synthetic version conflict",
          },
          status: 409,
        },
        { status: 409 },
      );
    }),
  );
  const run = await fixture.run(app, [
    "docs",
    "index",
    "sample-a",
    "doc-1",
    "--body-file",
    body,
    "--if-seq-no",
    "7",
    "--if-primary-term",
    "2",
    "--json",
  ]);
  assert.equal(run.exitCode, 1);
  assert.equal(JSON.parse(run.stderr).error.code, "document.conflict");
});

test("M5 mutations are denied before every HTTP boundary without their category", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  let calls = 0;
  server.use(
    http.all("*", () => {
      calls++;
      return HttpResponse.json({});
    }),
  );
  const body = await inputFile(t, {});
  const file = await inputFile(t, '{"title":"Synthetic"}\n', true);
  const cases = [
    ["docs", "index", "sample-a", "doc-1", "--body-file", body],
    ["docs", "update", "sample-a", "doc-1", "--body-file", body],
    ["docs", "delete", "sample-a", "doc-1"],
    ["indices", "create", "sample-a"],
    ["indices", "delete", "sample-a"],
    ["reindex", "--source", "sample-a", "--dest", "sample-b"],
    ["docs", "delete-by-query", "sample-a", "--q", "title:example"],
    ["aliases", "add", "sample-alias", "sample-a"],
    ["aliases", "remove", "sample-alias", "sample-a"],
    [
      "aliases",
      "swap",
      "sample-alias",
      "--from",
      "sample-a",
      "--to",
      "sample-b",
    ],
    ["bulk", "load", "sample-a", "--file", file],
  ];
  for (const argv of cases) {
    const run = await fixture.run(app, [...argv, "--json"]);
    assert.equal(run.exitCode, 1, argv.join(" "));
    assert.equal(
      JSON.parse(run.stderr).error.code,
      "permission.denied",
      argv.join(" "),
    );
  }
  assert.equal(calls, 0);
});

test("Story21 bulk load batches documents and reports full totals", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  await grant(app, "Update");
  const path = await inputFile(
    t,
    '{"id":"a","title":"One"}\n{"id":"b","title":"Two"}\n{"id":"c","title":"Three"}\n',
    true,
  );
  let batches = 0;
  server.use(
    http.post(origin + "/search/sample-a/_bulk", async ({ request }) => {
      assert.match(
        request.headers.get("content-type")!,
        /application\/x-ndjson/,
      );
      const text = await request.text();
      assert.ok(text.endsWith("\n"));
      const lines = text
        .trimEnd()
        .split("\n")
        .map((x) => JSON.parse(x));
      const ids = batches++ === 0 ? ["a", "b"] : ["c"];
      assert.equal(lines.length, ids.length * 2);
      ids.forEach((id, i) =>
        assert.deepEqual(lines[i * 2], { index: { _id: id } }),
      );
      return HttpResponse.json({
        took: 2,
        errors: false,
        items: ids.map((id) => ({
          index: { _id: id, status: 201, result: "created" },
        })),
      });
    }),
  );
  const result = (await fixture.json(app, [
    "bulk",
    "load",
    "sample-a",
    "--file",
    path,
    "--id-field",
    "id",
    "--batch-size",
    "2",
  ])) as any;
  assert.equal(batches, 2);
  assert.equal(result.succeeded, 3);
  assert.equal(result.failed, 0);
  assert.equal(result.took, 4);
});

test("Story21 bulk partial report retains input line, id, status and reason", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  await grant(app, "Update");
  const path = await inputFile(t, '{"id":"a"}\n{"id":"b"}\n', true);
  server.use(
    http.post(origin + "/search/sample-a/_bulk", () =>
      HttpResponse.json({
        took: 3,
        errors: true,
        items: [
          { index: { _id: "a", status: 201 } },
          {
            index: {
              _id: "b",
              status: 400,
              error: {
                type: "mapper_parsing_exception",
                reason: "Synthetic mapping conflict",
              },
            },
          },
        ],
      }),
    ),
  );
  const argv = ["bulk", "load", "sample-a", "--file", path, "--id-field", "id"];
  const run = await fixture.run(app, [...argv, "--json"]);
  assert.equal(run.exitCode, 1);
  assert.equal(JSON.parse(run.stderr).error.code, "bulk.partial");
  const report = JSON.parse(run.stdout);
  assert.equal(report.succeeded, 1);
  assert.equal(report.failed, 1);
  assert.deepEqual(report.failures, [
    { line: 2, _id: "b", status: 400, reason: "Synthetic mapping conflict" },
  ]);
  const [reply] = (await fixture.rpc(app, [argv])) as any[];
  assert.deepEqual(reply.error.data.result, report);
  const human = await fixture.run(app, argv);
  assert.equal(human.exitCode, 1);
  assert.match(human.stdout, /Synthetic mapping conflict/);
});

test("Story21 malformed NDJSON is rejected completely before the first batch", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  await grant(app, "Update");
  let calls = 0;
  server.use(
    http.all("*", () => {
      calls++;
      return HttpResponse.json({});
    }),
  );
  const path = await inputFile(t, '{"id":"a"}\n{"id":\n', true);
  const run = await fixture.run(app, [
    "bulk",
    "load",
    "sample-a",
    "--file",
    path,
    "--batch-size",
    "1",
    "--json",
  ]);
  assert.equal(run.exitCode, 1);
  assert.equal(JSON.parse(run.stderr).error.code, "bulk.invalidInput");
  assert.match(run.stderr, /line 2/i);
  assert.equal(calls, 0);
});

test("Story21 bulk action file requires both Update and Delete for deletes", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  const content =
    '{"index":{"_index":"sample-a","_id":"a"}}\n{"title":"One"}\n{"delete":{"_index":"sample-a","_id":"b"}}\n';
  const path = await inputFile(t, content, true);
  let calls = 0;
  server.use(
    http.post(origin + "/search/_bulk", async ({ request }) => {
      calls++;
      assert.equal(await request.text(), content);
      return HttpResponse.json({
        took: 1,
        errors: false,
        items: [
          { index: { _id: "a", status: 201 } },
          { delete: { _id: "b", status: 200 } },
        ],
      });
    }),
  );
  const argv = ["bulk", "run", "--file", path];
  await grant(app, "Update");
  const denied = await fixture.run(app, [...argv, "--json"]);
  assert.equal(denied.exitCode, 1);
  assert.equal(JSON.parse(denied.stderr).error.code, "permission.denied");
  assert.equal(calls, 0);
  await grant(app, "Delete");
  const result = (await fixture.json(app, argv)) as any;
  assert.equal(result.succeeded, 2);
  assert.equal(calls, 1);
  await app.execute(["permissions", "revoke", "Update"]);
  const updateDenied = await fixture.run(app, [...argv, "--json"]);
  assert.equal(updateDenied.exitCode, 1);
  assert.equal(JSON.parse(updateDenied.stderr).error.code, "permission.denied");
  assert.equal(calls, 1);
});

test("Story22 creates indices from body plus shard settings and deletes by name", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  await grant(app, "Update", "Delete");
  const body = await inputFile(t, {
    settings: { refresh_interval: "5s" },
    mappings: { properties: { title: { type: "text" } } },
  });
  server.use(
    http.head(
      origin + "/search/sample-a",
      () => new HttpResponse(null, { status: 404 }),
    ),
    http.put(origin + "/search/sample-a", async ({ request }) => {
      assert.deepEqual(await request.json(), {
        settings: {
          refresh_interval: "5s",
          number_of_shards: 1,
          number_of_replicas: 0,
        },
        mappings: { properties: { title: { type: "text" } } },
      });
      return HttpResponse.json({
        acknowledged: true,
        shards_acknowledged: true,
        index: "sample-a",
      });
    }),
    http.delete(origin + "/search/sample-a", () =>
      HttpResponse.json({ acknowledged: true }),
    ),
  );
  const result = (await fixture.json(app, [
    "indices",
    "create",
    "sample-a",
    "--body-file",
    body,
    "--shards",
    "1",
    "--replicas",
    "0",
  ])) as any;
  assert.equal(result.shards_acknowledged, true);
  const [reply] = (await fixture.rpc(app, [
    ["indices", "delete", "sample-a"],
  ])) as any[];
  assert.equal(reply.result.acknowledged, true);
});

test("Story22 existing indices, wildcard opt-in and missing acknowledgements are visible", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  await grant(app, "Update", "Delete");
  let deletes = 0;
  server.use(
    http.head(
      origin + "/search/sample-a",
      () => new HttpResponse(null, { status: 200 }),
    ),
    http.delete(origin + "/search/sample-*", () => {
      deletes++;
      return HttpResponse.json({ acknowledged: false });
    }),
  );
  const existing = await fixture.run(app, [
    "indices",
    "create",
    "sample-a",
    "--json",
  ]);
  assert.equal(JSON.parse(existing.stderr).error.code, "index.exists");
  for (const index of ["sample-*", "_all"]) {
    const refused = await fixture.run(app, [
      "indices",
      "delete",
      index,
      "--json",
    ]);
    assert.equal(JSON.parse(refused.stderr).error.code, "usage");
  }
  assert.equal(deletes, 0);
  const run = await fixture.run(app, [
    "indices",
    "delete",
    "sample-*",
    "--allow-wildcards",
    "--json",
  ]);
  assert.equal(run.exitCode, 1);
  assert.equal(JSON.parse(run.stderr).error.code, "operation.unacknowledged");
  assert.equal(deletes, 1);
});

test("Story23 wait returns counts, no-wait returns task plus runnable next", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  await grant(app, "Update", "Delete");
  const counts = {
    took: 2,
    timed_out: false,
    total: 3,
    created: 3,
    updated: 0,
    deleted: 0,
    version_conflicts: 0,
    failures: [],
  };
  server.use(
    http.post(origin + "/search/_reindex", async ({ request }) => {
      assert.deepEqual(await request.json(), {
        source: {
          index: "sample-a",
          query: { query_string: { query: "title:example" } },
        },
        dest: { index: "sample-b" },
      });
      return HttpResponse.json(
        new URL(request.url).searchParams.get("wait_for_completion") === "true"
          ? counts
          : { task: "node-a:7" },
      );
    }),
    http.post(
      origin + "/search/sample-a/_delete_by_query",
      async ({ request }) => {
        assert.deepEqual(await request.json(), {
          query: { query_string: { query: "title:example" } },
        });
        assert.equal(
          new URL(request.url).searchParams.get("wait_for_completion"),
          "true",
        );
        return HttpResponse.json({ ...counts, created: 0, deleted: 3 });
      },
    ),
  );
  const argv = [
    "reindex",
    "--source",
    "sample-a",
    "--dest",
    "sample-b",
    "--q",
    "title:example",
  ];
  assert.deepEqual(await fixture.json(app, [...argv, "--wait"]), counts);
  assert.deepEqual(await fixture.json(app, [...argv, "--no-wait"]), {
    task: "node-a:7",
    next: [["tasks", "show", "node-a:7"]],
  });
  const human = await fixture.run(app, [...argv, "--no-wait"]);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /opensearch-cli tasks show node-a:7/);
  assert.equal(
    (
      (await fixture.json(app, [
        "docs",
        "delete-by-query",
        "sample-a",
        "--q",
        "title:example",
        "--wait",
      ])) as any
    ).deleted,
    3,
  );
});

test("Story23 completed failures exit nonzero while preserving all counts", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  await grant(app, "Update");
  const wire = {
    total: 3,
    created: 2,
    updated: 0,
    deleted: 0,
    version_conflicts: 1,
    failures: [
      {
        index: "sample-b",
        id: "a",
        status: 409,
        cause: {
          type: "version_conflict_engine_exception",
          reason: "Synthetic conflict",
        },
      },
    ],
  };
  server.use(
    http.post(origin + "/search/_reindex", () => HttpResponse.json(wire)),
  );
  const run = await fixture.run(app, [
    "reindex",
    "--source",
    "sample-a",
    "--dest",
    "sample-b",
    "--wait",
    "--json",
  ]);
  assert.equal(run.exitCode, 1);
  assert.equal(JSON.parse(run.stderr).error.code, "operation.partial");
  assert.deepEqual(JSON.parse(run.stdout), wire);
});

test("Story24 alias swap uses one atomic guarded request; add and remove are Update", async (t) => {
  const { fixture, server, app } = await setupExplore(t);
  await grant(app, "Update");
  let mode = "swap";
  let writes = 0;
  server.use(
    http.get(origin + "/search/_alias/sample-alias", () =>
      HttpResponse.json({ "sample-a": { aliases: { "sample-alias": {} } } }),
    ),
    http.post(origin + "/search/_aliases", async ({ request }) => {
      writes++;
      assert.deepEqual(await request.json(), {
        actions:
          mode === "swap"
            ? [
                {
                  remove: {
                    index: "sample-a",
                    alias: "sample-alias",
                    must_exist: true,
                  },
                },
                { add: { index: "sample-b", alias: "sample-alias" } },
              ]
            : mode === "add"
              ? [{ add: { index: "sample-b", alias: "sample-alias" } }]
              : [
                  {
                    remove: {
                      index: "sample-a",
                      alias: "sample-alias",
                      must_exist: true,
                    },
                  },
                ],
      });
      return HttpResponse.json({ acknowledged: true });
    }),
  );
  const argv = [
    "aliases",
    "swap",
    "sample-alias",
    "--from",
    "sample-a",
    "--to",
    "sample-b",
  ];
  assert.deepEqual(await fixture.json(app, argv), { acknowledged: true });
  assert.equal(writes, 1);
  mode = "add";
  assert.equal(
    (
      (await fixture.json(app, [
        "aliases",
        "add",
        "sample-alias",
        "sample-b",
      ])) as any
    ).acknowledged,
    true,
  );
  mode = "remove";
  assert.equal(
    (
      (await fixture.json(app, [
        "aliases",
        "remove",
        "sample-alias",
        "sample-a",
      ])) as any
    ).acknowledged,
    true,
  );
  server.use(
    http.get(origin + "/search/_alias/sample-alias", () =>
      HttpResponse.json({
        "sample-other": { aliases: { "sample-alias": {} } },
      }),
    ),
  );
  const wrong = await fixture.run(app, [...argv, "--json"]);
  assert.equal(wrong.exitCode, 1);
  assert.equal(JSON.parse(wrong.stderr).error.code, "alias.sourceMismatch");
  assert.equal(writes, 3);
});
