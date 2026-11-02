import assert from "node:assert/strict";
import test from "node:test";
import { http, HttpResponse } from "msw";
import { origin, setupExplore } from "./explore-fixture.js";

test("bug629 human node statistics format bytes while machine metrics stay numeric", async (t) => {
  // WHAT: review627 reproduced raw heap and filesystem byte counts in human node statistics.
  // HOW: the supported command formats JVM/fs bytes via Core while JSON/execute/RPC retain native values.
  const { fixture, server, app } = await setupExplore(t);
  const wire = {
    _nodes: { total: 1, successful: 1, failed: 0 },
    nodes: {
      "node-a": {
        name: "sample-node",
        jvm: { mem: { heap_used_in_bytes: 1073741824, heap_used_percent: 12 } },
        fs: { total: { total_in_bytes: 1099511627776 } },
      },
    },
  };
  server.use(
    http.get(origin + "/search/_nodes/node-a/stats/jvm,fs", () =>
      HttpResponse.json(wire),
    ),
  );
  const argv = ["nodes", "stats", "node-a", "--metric", "jvm,fs"];
  assert.deepEqual(await fixture.json(app, argv), wire);
  assert.deepEqual(await app.execute(argv), wire);
  const [reply] = (await fixture.rpc(app, [argv])) as any[];
  assert.deepEqual(reply.result, wire);
  const human = await fixture.run(app, argv);
  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /1\.0 GiB/);
  assert.match(human.stdout, /1\.0 TiB/);
  assert.match(human.stdout, /heap_used_percent.*12/);
  assert.match(human.stdout, /sample-node/);
  assert.ok(!human.stdout.includes("1073741824"));
  assert.ok(!human.stdout.includes("1099511627776"));
});
