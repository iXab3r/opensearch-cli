import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createCli, ProfileSecrets } from "@eyeauras/cli-factory";
import { createCliFixture } from "@eyeauras/cli-factory/testing";
import { createDefinition } from "../src/cli.js";

const first = "https://first.example.com/";
const second = "https://second.example.com/";
const info = { name: "node-example", cluster_name: "cluster-example", cluster_uuid: "synthetic-id", version: { distribution: "opensearch", number: "3.2.0" } };
const oldBasic = JSON.stringify({ username: "operator", password: "synthetic-old" });
async function setup(t: test.TestContext, auth = "basic", basic?: string) {
  const fixture = await createCliFixture(t, { applicationId: "opensearch-cli", profiles: [{ name: "default", values: { url: first, auth }, ...(basic ? { secrets: { basic } } : {}) }] });
  const server = setupServer();
  server.listen({ onUnhandledFrame: "error" });
  t.after(() => server.close());
  const app = fixture.createApplication(runtime => createCli({ ...createDefinition(), runtime }));
  const secrets = new ProfileSecrets(fixture.secretStore, "opensearch-cli", "default");
  return { fixture, server, app, secrets };
}

// #573: the reviewed regression reuses an old credential after changing the connection.
test("M1 successful scheme changes retire superseded credentials", async t => {
  const { fixture, server, app, secrets } = await setup(t, "basic", oldBasic);
  server.use(http.get(second, () => HttpResponse.json(info)), http.get(second + "_plugins/_security/authinfo", () => HttpResponse.json({ user_name: "operator", roles: ["reader"] })));
  let result = await fixture.run(app, ["profile", "configure", "default", "--url", second, "--auth", "bearer", "--token-stdin", "--json"], { input: Readable.from(["synthetic-new\n"]) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await secrets.get("basic"), undefined);
  assert.equal(await secrets.get("token"), "synthetic-new");
  await fixture.json(app, ["profile", "set", "default", "--auth", "basic"]);
  result = await fixture.run(app, ["cluster", "info", "--json"]);
  assert.notEqual(result.exitCode, 0, "The first endpoint's Basic credential must not reach the second endpoint");
  result = await fixture.run(app, ["profile", "configure", "default", "--auth", "none", "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await secrets.get("basic"), undefined);
  assert.equal(await secrets.get("token"), undefined);
});
// #574: an open profile previously reported success without any remote status call.
test("M1 open-profile status checks reachability and reports the URL", async t => {
  const { fixture, server, app } = await setup(t, "none");
  server.use(http.get(first, ({ request }) => {
    assert.equal(request.headers.get("authorization"), null);
    return HttpResponse.json(info);
  }), http.get(first + "_plugins/_security/authinfo", () => new HttpResponse(null, { status: 404 })));
  const status = await fixture.json(app, ["auth", "status"]) as any;
  assert.equal(status.authenticated, true);
  assert.equal(status.identity.url, first);
  assert.equal(status.identity.reachable, true);
  server.use(http.get(first, () => HttpResponse.error()));
  const failed = await fixture.run(app, ["auth", "status", "--json"]);
  assert.notEqual(failed.exitCode, 0);
  assert.match(JSON.parse(failed.stderr).error.code, /^request\./);
});
// #575: Core's bearer wrapper hid the agreed HTTP credential rejection and recovery hint.
test("M1 bearer rejection preserves credentials and returns actionable HTTP failure", async t => {
  const { fixture, server, app, secrets } = await setup(t, "basic", oldBasic);
  server.use(http.get(second, () => new HttpResponse(null, { status: 401 })));
  const before = await fixture.profileStore.list();
  const result = await fixture.run(app, ["profile", "configure", "default", "--url", second, "--auth", "bearer", "--token-stdin", "--json"], { input: Readable.from(["synthetic-rejected\n"]) });
  assert.notEqual(result.exitCode, 0);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, "http.unauthorized");
  assert.ok(error.next.some((argv: string[]) => argv.includes("--token-stdin")));
  assert.deepEqual(await fixture.profileStore.list(), before);
  assert.equal(await secrets.get("basic"), oldBasic);
  assert.equal(await secrets.get("token"), undefined);
});
for (const scheme of ["basic", "bearer"]) test(`M1 missing ${scheme} credentials identify configuration flags in JSON and RPC`, async t => {
  const { fixture, app } = await setup(t, scheme);
  const result = await fixture.run(app, ["cluster", "info", "--json"]);
  const error = JSON.parse(result.stderr).error;
  const expected = scheme === "basic" ? ["--username", "--password-stdin"] : ["--token-stdin"];
  for (const flag of expected) assert.ok(error.message.includes(flag));
  const [reply] = await fixture.rpc(app, [["cluster", "info"]]) as any[];
  for (const flag of expected) assert.ok(reply.error.message.includes(flag));
});

test("M1 Basic preserves password whitespace and configured context/port", async t => {
  const { fixture, server, app } = await setup(t, "none");
  const password = " synthetic password ";
  const configured = "https://first.example.com:443/search/";
  server.use(http.get(first + "search/", ({ request }) => {
    assert.equal(request.headers.get("authorization"), "Basic " + Buffer.from(`operator:${password}`).toString("base64"));
    return HttpResponse.json(info);
  }), http.get(first + "search/_plugins/_security/authinfo", () => new HttpResponse(null, { status: 404 })));
  const result = await fixture.run(app, ["profile", "configure", "spaced", "--url", configured, "--auth", "basic", "--username", "operator", "--password-stdin", "--json"], { input: Readable.from([password + "\n"]) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fixture.profileStore.get("spaced")).values.url, configured);
  await fixture.json(app, ["cluster", "info", "--profile", "spaced"]);
});

// #576: built-in auth identity was displayed as one compact JSON cell in human mode.
for (const action of ["configure", "login", "status"]) test(`M1 ${action} renders readable identity while machine data stays structured`, async t => {
  const { fixture, server, app } = await setup(t, "basic", oldBasic);
  const identity = { url: first, reachable: true, user: "operator", roles: ["reader", "monitor"] };
  server.use(http.get(first, ({ request }) => {
    assert.equal(request.headers.get("authorization"), "Basic " + Buffer.from("operator:synthetic-old").toString("base64"));
    return HttpResponse.json(info);
  }), http.get(first + "_plugins/_security/authinfo", () => HttpResponse.json({ user_name: "operator", roles: identity.roles })));
  const credentialOptions = ["--username", "operator", "--password-stdin"];
  const argv = action === "configure" ? ["profile", "configure", "default", "--url", first, "--auth", "basic", ...credentialOptions]
    : ["auth", action, ...(action === "login" ? credentialOptions : [])];
  const result = await fixture.run(app, argv, { input: Readable.from(["synthetic-old\n"]) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /identity:\n  url: https:\/\/first\.example\.com\/\n  reachable: true\n  user: operator\n  roles:\n    - reader\n    - monitor/);
  assert.match(result.stdout, /profile: default/);
  assert.doesNotMatch(result.stdout + result.stderr, /identity: \{|synthetic-old/);
  const expected = { ...(action === "configure" ? { configured: true } : {}), profile: "default", authenticated: true, identity };
  assert.deepEqual(await fixture.json(app, argv, { input: Readable.from(["synthetic-old\n"]) }), expected);
  const status = { authenticated: true, identity, profile: "default" };
  assert.deepEqual(await app.execute(["auth", "status"]), status);
  const [reply] = await fixture.rpc(app, [["auth", "status"]]) as { result: unknown }[];
  assert.deepEqual(reply!.result, status);
});
