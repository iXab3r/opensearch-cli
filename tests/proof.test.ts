import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
// @ts-expect-error Development runner is intentionally plain JavaScript.
import { runProof } from "../../scripts/proof.mjs";

test("proof has a fixed read-only inventory and prints only summaries", async () => {
  const commands: unknown[] = [];
  const rows = await runProof("synthetic", async ({ argv }: { argv: string[] }) => {
    commands.push(argv);
    if (argv[0] === "auth") return JSON.stringify({ authenticated: true });
    if (argv[1] === "info") return JSON.stringify({ cluster_name: "cluster-example", version: { number: "3.2.0" } });
    return JSON.stringify({ status: "green", timed_out: false });
  });
  assert.deepEqual(commands, [
    ["auth", "status", "--profile", "synthetic", "--json"],
    ["cluster", "info", "--profile", "synthetic", "--json"],
    ["cluster", "health", "--profile", "synthetic", "--json"],
  ]);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row: string) => row.endsWith(": PASS")));
  assert.doesNotMatch(rows.join("\n"), /cluster-example|3\.2\.0/);
});
test("proof entry refuses CI before package preparation", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/proof.mjs", import.meta.url)), "--profile", "synthetic"], { env: { ...process.env, CI: "true" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /no service payload/);
});
