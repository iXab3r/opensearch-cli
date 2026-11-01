import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createProofInvoker, parseProofProfile } from "@eyeauras/cli-factory/proof";

// Fixed read-only inventory, not a command passthrough or fixture capture mechanism.
export async function runProof(profile, invoke) {
  const rows = [
    { argv: ["auth", "status"], check: value => value.authenticated === true },
    { argv: ["cluster", "info"], check: value => typeof value.cluster_name === "string" && typeof value.version?.number === "string" },
    { argv: ["cluster", "health"], check: value => ["green", "yellow", "red"].includes(value.status) && value.timed_out === false },
  ];
  for (const row of rows) {
    const value = JSON.parse(await invoke({ argv: [...row.argv, "--profile", profile, "--json"] }));
    if (!row.check(value)) throw new Error("Profile proof returned incomplete evidence.");
  }
  return rows.map(row => `${row.argv.join(" ")}: PASS`);
}

async function main() {
  // Must reject CI and unsupported arguments before even preparing a package.
  const profile = parseProofProfile(process.argv.slice(2), process.env);
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "Run through npm run proof -- --profile <name>.");
  const temporary = await mkdtemp(join(tmpdir(), "opensearch-proof-"));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(npm_config_|npm_token$|node_auth_token$|gh_token$|github_token$|node_options$|node_path$)/i.test(key)) delete env[key];
  const npm = argv => {
    const result = spawnSync(process.execPath, [npmCli, ...argv, "--cache", join(temporary, "cache"), "--userconfig", join(temporary, "npmrc"), "--globalconfig", join(temporary, "global-npmrc"), "--registry", "https://registry.npmjs.org/"], {
      cwd: root, env, encoding: "utf8", timeout: 180_000, windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error("Could not prepare the installed proof package.");
    return result.stdout;
  };
  try {
    await Promise.all([mkdir(join(temporary, "prefix")), writeFile(join(temporary, "npmrc"), ""), writeFile(join(temporary, "global-npmrc"), "")]);
    const [packed] = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", temporary]));
    npm(["install", "--global", "--prefix", join(temporary, "prefix"), "--no-audit", "--no-fund", join(temporary, packed.filename)]);
    const executable = join(temporary, "prefix", ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", "@eyeauras", "opensearch-cli", "dist", "src", "bin.js");
    const rows = await runProof(profile, createProofInvoker({ executable: pathToFileURL(executable) }));
    for (const row of rows) console.log(row);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); }
  catch { console.error("Profile proof failed; no service payload was retained."); process.exitCode = 1; }
}
