import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCli } from "@eyeauras/cli-factory";
import { createCliFixture } from "@eyeauras/cli-factory/testing";
import { createDefinition } from "../src/cli.js";

// Protect the supported metadata, isolated profile and persistent RPC workflows.
test("CLI metadata, profiles and JSON-RPC use the framework", async t => {
  const fixture = await createCliFixture(t, { applicationId: "opensearch-cli" });
  const app = fixture.createApplication(runtime => createCli({ ...createDefinition(), runtime }));
  const help = await fixture.run(app, ["--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /opensearch-cli/);
  const metadata = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const version = await fixture.run(app, ["--version"]);
  assert.equal(version.stdout.trim(), metadata.version);
  assert.ok(await fixture.json(app, ["profile", "list"]));
  const replies = await fixture.rpc(app, [["--help"], ["--help"]]);
  assert.equal(replies.length, 2);
  for (const reply of replies) assert.ok((reply as { result?: unknown }).result);
});
