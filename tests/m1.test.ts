import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createCli, ProfileSecrets } from "@eyeauras/cli-factory";
import { createCliFixture } from "@eyeauras/cli-factory/testing";
import { createDefinition } from "../src/cli.js";

const origin = "https://cluster.example.com";
const info = JSON.parse(await readFile(new URL("../../tests/fixtures/m1/info-3.json", import.meta.url), "utf8"));
const health = JSON.parse(await readFile(new URL("../../tests/fixtures/m1/health.json", import.meta.url), "utf8"));
async function setup(t: test.TestContext, profiles?: Parameters<typeof createCliFixture>[1]["profiles"]) {
  const fixture = await createCliFixture(t, { applicationId: "opensearch-cli", ...(profiles ? { profiles } : {}) });
  const server = setupServer();
  server.listen({ onUnhandledFrame: "error" });
  t.after(() => server.close());
  const app = fixture.createApplication(runtime => createCli({ ...createDefinition(), runtime }));
  return { fixture, server, app };
}
const open = [{ name: "default", values: { url: origin + "/", auth: "none" } }];

// Story 1: use supported profile/auth commands, with native fetch mocked by MSW.
test("M1 configure validates Basic before secure storage and reports identity", async t => {
  const { fixture, server, app } = await setup(t);
  server.use(http.get(origin + "/", ({ request }) => {
    assert.equal(request.headers.get("authorization"), "Basic " + Buffer.from("operator:synthetic-password").toString("base64"));
    return HttpResponse.json(info);
  }), http.get(origin + "/_plugins/_security/authinfo", () => HttpResponse.json({ user_name: "operator", roles: ["reader"] })));
  const configured = await fixture.run(app, ["profile", "configure", "dev", "--url", origin, "--auth", "basic", "--username", "operator", "--password-stdin", "--json"], { input: Readable.from(["synthetic-password\n"]) });
  assert.equal(configured.exitCode, 0, configured.stderr);
  assert.doesNotMatch(JSON.stringify(await fixture.profileStore.list()), /synthetic-password/);
  const secrets = new ProfileSecrets(fixture.secretStore, "opensearch-cli", "dev");
  assert.ok(await secrets.get("basic"));
  const status = await fixture.json(app, ["auth", "status", "--profile", "dev"]) as any;
  assert.equal(status.authenticated, true);
  assert.equal(status.identity.url, origin + "/");
  assert.equal(status.identity.user, "operator");
  assert.deepEqual(status.identity.roles, ["reader"]);
  assert.doesNotMatch(configured.stdout + configured.stderr, /synthetic-password/);
});
test("M1 bearer configure normalizes stdin and validates before storage", async t => {
  const { fixture, server, app } = await setup(t);
  server.use(http.get(origin + "/", ({ request }) => {
    assert.equal(request.headers.get("authorization"), "Bearer synthetic-bearer");
    return HttpResponse.json(info);
  }), http.get(origin + "/_plugins/_security/authinfo", () => new HttpResponse(null, { status: 404 })));
  const result = await fixture.run(app, ["profile", "configure", "prod", "--url", origin, "--auth", "bearer", "--token-stdin", "--json"], { input: Readable.from(["  synthetic-bearer\n"]) });
  assert.equal(result.exitCode, 0, result.stderr);
  const secrets = new ProfileSecrets(fixture.secretStore, "opensearch-cli", "prod");
  assert.equal(await secrets.get("token"), "synthetic-bearer");
  const status = await fixture.json(app, ["auth", "status", "--profile", "prod"]) as any;
  assert.equal(status.authenticated, true);
  assert.equal(status.identity.reachable, true);
  assert.equal(status.identity.user, undefined);
});
test("M1 none configures an open cluster without credentials", async t => {
  const { fixture, server, app } = await setup(t);
  server.use(http.get(origin + "/", ({ request }) => {
    assert.equal(request.headers.get("authorization"), null);
    return HttpResponse.json(info);
  }));
  const result = await fixture.run(app, ["profile", "configure", "local", "--url", origin, "--auth", "none", "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const secrets = new ProfileSecrets(fixture.secretStore, "opensearch-cli", "local");
  assert.equal(await secrets.get("basic"), undefined);
  assert.equal(await secrets.get("token"), undefined);
  assert.equal((await fixture.json(app, ["cluster", "info", "--profile", "local"]) as any).cluster_name, info.cluster_name);
});
test("M1 rejected Basic reconfiguration preserves the existing profile and secret", async t => {
  const { fixture, server, app } = await setup(t, [{ name: "default", values: { url: origin + "/", auth: "basic" }, secrets: { basic: JSON.stringify({ username: "operator", password: "synthetic-old" }) } }]);
  server.use(http.get("https://other.example.com/", () => new HttpResponse(null, { status: 401 })));
  const before = await fixture.profileStore.list();
  const result = await fixture.run(app, ["profile", "configure", "default", "--url", "https://other.example.com", "--auth", "basic", "--username", "operator", "--password-stdin", "--json"], { input: Readable.from(["synthetic-wrong\n"]) });
  assert.notEqual(result.exitCode, 0);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, "http.unauthorized");
  assert.ok(error.next.length);
  assert.deepEqual(await fixture.profileStore.list(), before);
  const secrets = new ProfileSecrets(fixture.secretStore, "opensearch-cli", "default");
  assert.equal(JSON.parse((await secrets.get("basic"))!).password, "synthetic-old");
  assert.doesNotMatch(result.stderr, /synthetic-wrong/);
});
test("M1 RPC selects each profile's URL and credentials", async t => {
  const { fixture, server, app } = await setup(t, [
    { name: "default", values: { url: origin + "/", auth: "bearer" }, secrets: { token: "synthetic-one" } },
    { name: "prod", values: { url: "https://other.example.com/", auth: "bearer" }, secrets: { token: "synthetic-two" } },
  ]);
  const seen: string[] = [];
  for (const [url, token] of [[origin, "synthetic-one"], ["https://other.example.com", "synthetic-two"]] as const) {
    server.use(http.get(url + "/", ({ request }) => {
      assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
      seen.push(url);
      return HttpResponse.json(info);
    }));
  }
  const replies = await fixture.rpc(app, [["cluster", "info"], ["cluster", "info", "--profile", "prod"]]) as any[];
  assert.ok(replies.every(reply => reply.result));
  assert.deepEqual(seen, [origin, "https://other.example.com"]);
});
test("M1 missing credentials fail without prompts in JSON and RPC", async t => {
  const { fixture, app } = await setup(t, [{ name: "default", values: { url: origin + "/", auth: "basic" } }]);
  const result = await fixture.run(app, ["cluster", "info", "--json"]);
  assert.notEqual(result.exitCode, 0);
  const error = JSON.parse(result.stderr).error;
  assert.match(error.message, /--username/);
  assert.match(error.message, /--password-stdin/);
  const [reply] = await fixture.rpc(app, [["cluster", "info"]]) as any[];
  assert.ok(reply.error);
});

// Story 2: project the same cluster metadata in human and machine forms.
for (const major of [2, 3]) test(`M1 cluster info renders OpenSearch ${major}`, async t => {
  const { fixture, server, app } = await setup(t, open);
  const expected = JSON.parse(await readFile(new URL(`../../tests/fixtures/m1/info-${major}.json`, import.meta.url), "utf8"));
  server.use(http.get(origin + "/", () => HttpResponse.json(expected)));
  const result = await fixture.json(app, ["cluster", "info"]) as any;
  assert.deepEqual(result, expected);
  const human = await fixture.run(app, ["cluster", "info"]);
  for (const field of [expected.cluster_name, expected.cluster_uuid, expected.version.number, expected.version.build_date, expected.version.build_hash, expected.version.lucene_version]) assert.ok(human.stdout.includes(field));
});
test("M1 unsupported distribution or version is reported with a stderr warning", async t => {
  const { fixture, server, app } = await setup(t, open);
  for (const version of [{ ...info.version, number: "4.0.0" }, { ...info.version, distribution: "other" }]) {
    const expected = { ...info, version };
    server.use(http.get(origin + "/", () => HttpResponse.json(expected)));
    const result = await fixture.run(app, ["cluster", "info", "--json"]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), expected);
    assert.match(result.stderr, /unsupported/i);
  }
});

// Story 3: preserve observed health and timeout results, including per-index detail.
test("M1 cluster health reports shard state and per-index status", async t => {
  const { fixture, server, app } = await setup(t, open);
  server.use(http.get(origin + "/_cluster/health", () => HttpResponse.json(health)),
    http.get(origin + "/_cluster/health/:index", ({ request, params }) => {
      assert.equal(params.index, "sample-*");
      assert.equal(new URL(request.url).searchParams.get("level"), "indices");
      return HttpResponse.json({ ...health, indices: { "sample-one": { status: "yellow" } } });
    }));
  assert.deepEqual(await fixture.json(app, ["cluster", "health"]), health);
  const human = await fixture.run(app, ["cluster", "health"]);
  assert.match(human.stdout, /green/);
  const detail = await fixture.run(app, ["cluster", "health", "--index", "sample-*", "--level", "indices"]);
  assert.match(detail.stdout, /sample-one/);
  assert.match(detail.stdout, /yellow/);
});
test("M1 health timeout returns failed outcome with the observed state", async t => {
  const { fixture, server, app } = await setup(t, open);
  const expected = { ...health, timed_out: true, status: "yellow" };
  server.use(http.get(origin + "/_cluster/health", ({ request }) => {
    const query = new URL(request.url).searchParams;
    assert.equal(query.get("wait_for_status"), "green");
    assert.equal(query.get("timeout"), "30s");
    return HttpResponse.json(expected, { status: 408 });
  }));
  const result = await fixture.run(app, ["cluster", "health", "--wait-for-status", "green", "--timeout", "30s", "--json"]);
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(JSON.parse(result.stderr).error.code, "opensearch.healthTimeout");
});
test("M1 reading a red cluster is a successful read", async t => {
  const { fixture, server, app } = await setup(t, open);
  server.use(http.get(origin + "/_cluster/health", () => HttpResponse.json({ ...health, status: "red" })));
  const result = await fixture.run(app, ["cluster", "health"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /red/);
});
