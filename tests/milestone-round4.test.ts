import assert from "node:assert/strict";
import test from "node:test";
import { http, HttpResponse } from "msw";
import { origin, setupExplore } from "./explore-fixture.js";

test("bug623 cancellation wall time is an instant only in human task views", async (t) => {
  // WHAT: review624 reproduced raw cancellation_time_millis in native TaskInfo human output.
  // HOW: show/cancel format cancellation wall time while JSON/execute/RPC retain native milliseconds.
  const { fixture, server, app } = await setupExplore(t);
  await app.execute(["permissions", "grant", "Update"]);
  const timestamp = 1700000000000;
  const task = {
    node: "node-a",
    id: 7,
    cancelled: true,
    cancellation_time_millis: timestamp,
  };
  server.use(
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
    ["tasks", "show", "node-a:7"],
    ["tasks", "cancel", "node-a:7"],
  ]) {
    const json = await fixture.json(app, argv);
    assert.equal(JSON.stringify(json).includes(String(timestamp)), true);
    assert.deepEqual(await app.execute(argv), json);
    const [reply] = (await fixture.rpc(app, [argv])) as any[];
    assert.deepEqual(reply.result, json);
    const human = await fixture.run(app, argv);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /2023-11-14T22:13:20.000Z/);
    assert.ok(!human.stdout.includes(String(timestamp)));
  }
});

test("bug626 mutation acknowledgements identify the requested objects on all surfaces", async (t) => {
  // WHAT: review625 reproduced bare acknowledged:true for index deletion and all alias mutations.
  // HOW: real commands retain input selectors and human views name the action and affected objects.
  const { fixture, server, app } = await setupExplore(t);
  await app.execute(["permissions", "grant", "Update"]);
  await app.execute(["permissions", "grant", "Delete"]);
  server.use(
    http.delete(origin + "/search/sample-a", () =>
      HttpResponse.json({ acknowledged: true }),
    ),
    http.post(origin + "/search/_aliases", () =>
      HttpResponse.json({ acknowledged: true }),
    ),
    http.get(origin + "/search/_alias/sample-alias", () =>
      HttpResponse.json({ "sample-a": { aliases: { "sample-alias": {} } } }),
    ),
  );
  const cases = [
    {
      argv: ["indices", "delete", "sample-a"],
      result: { acknowledged: true, index: "sample-a" },
      labels: [/Deleted index/, /sample-a/],
    },
    {
      argv: ["aliases", "add", "sample-alias", "sample-a"],
      result: { acknowledged: true, alias: "sample-alias", index: "sample-a" },
      labels: [/Added alias/, /sample-alias/, /sample-a/],
    },
    {
      argv: ["aliases", "remove", "sample-alias", "sample-a"],
      result: { acknowledged: true, alias: "sample-alias", index: "sample-a" },
      labels: [/Removed alias/, /sample-alias/, /sample-a/],
    },
    {
      argv: [
        "aliases",
        "swap",
        "sample-alias",
        "--from",
        "sample-a",
        "--to",
        "sample-b",
      ],
      result: {
        acknowledged: true,
        alias: "sample-alias",
        from: "sample-a",
        to: "sample-b",
      },
      labels: [/Moved alias/, /sample-alias/, /sample-a/, /sample-b/],
    },
  ];
  for (const { argv, result, labels } of cases) {
    assert.deepEqual(await fixture.json(app, argv), result);
    assert.deepEqual(await app.execute(argv), result);
    const [reply] = (await fixture.rpc(app, [argv])) as any[];
    assert.deepEqual(reply.result, result);
    const human = await fixture.run(app, argv);
    assert.equal(human.exitCode, 0, human.stderr);
    for (const label of labels) assert.match(human.stdout, label);
  }
});
