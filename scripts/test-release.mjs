import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// WHAT: Exercise the supported Cake release targets with a local repository and stubbed npm.
// HOW: Supply one archive, stage/download it, retain evidence, then verify the registry/release.
test("Cake release targets preserve archive evidence and require owner approval", { timeout: 180_000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temp = await mkdtemp(join(tmpdir(), "opensearch-release-test-"));
  const fixture = join(temp, "repository");
  const bins = join(temp, "bin");
  const log = join(temp, "calls.jsonl");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/token|^npm_config_/i.test(key)) delete env[key];
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = bins + delimiter + env[pathKey];
  env.STUB_LOG = log;
  env.NPM_TOKEN = "synthetic-stage-credential";
  env.NODE_AUTH_TOKEN = "synthetic-unwanted-credential";
  env.GITHUB_TOKEN = "synthetic-release-credential";
  function run(tool, args, options = {}) {
    const result = spawnSync(tool, args, { cwd: fixture, env, encoding: "utf8", timeout: 120_000, windowsHide: true, ...options });
    assert.equal(result.status, 0, `${tool} failed: ${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  }
  try {
    for (const path of [bins, join(temp, "nuget"), join(fixture, "build"), join(fixture, "src"), join(fixture, "output", "release")]) await mkdir(path, { recursive: true });
    for (const file of await readdir(join(root, "build"))) if (/\.(cs|csproj)$/.test(file)) await copyFile(join(root, "build", file), join(fixture, "build", file));
    await writeFile(join(fixture, ".gitignore"), "build/bin/\nbuild/obj/\noutput/\n");
    await writeFile(join(fixture, "package.json"), JSON.stringify({ name: "@eyeauras/opensearch-cli", version: "0.1.0" }));
    await writeFile(join(fixture, "package-lock.json"), JSON.stringify({ version: "0.1.0", packages: { "": { version: "0.1.0" } } }));
    await writeFile(join(fixture, "src", "version.ts"), 'export const version = "0.1.0";\n');
    run("git", ["init", "--initial-branch=main"]);
    run("git", ["add", "."]);
    run("git", ["-c", "user.name=Synthetic Builder", "-c", "user.email=builder@example.invalid", "commit", "-m", "Synthetic release fixture"]);
    run("git", ["remote", "add", "origin", "."]);
    env.RELEASE_REVISION = run("git", ["rev-parse", "HEAD"]);
    const bytes = Buffer.from("synthetic tested archive\n");
    const manifest = { name: "@eyeauras/opensearch-cli", version: "0.1.0", commit: env.RELEASE_REVISION, file: "synthetic.tgz", shasum: createHash("sha1").update(bytes).digest("hex"), integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64") };
    env.STUB_MANIFEST = join(fixture, "output", "release", "release-manifest.json");
    await writeFile(env.STUB_MANIFEST, JSON.stringify(manifest));
    await writeFile(join(fixture, "output", "release", manifest.file), bytes);
    const stub = join(bins, "stub.mjs");
    await writeFile(stub, `import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const [tool, ...invocation] = process.argv.slice(2);
const args = tool === 'npm' ? invocation.slice(2) : invocation;
if (tool === 'npm') assert.deepEqual(invocation.slice(0, 2), ['--registry', 'https://registry.npmjs.org/']);
const m = JSON.parse(fs.readFileSync(process.env.STUB_MANIFEST));
assert.equal(process.env.NODE_AUTH_TOKEN, undefined);
assert.equal(process.env.GITHUB_TOKEN, undefined);
const stage = tool === 'npm' && args[0] === 'stage';
assert.equal(process.env.NPM_TOKEN, stage ? 'synthetic-stage-credential' : undefined);
if (tool === 'npm') {
  const config = fs.readFileSync(process.env.NPM_CONFIG_USERCONFIG, 'utf8');
  assert.equal(config, stage ? '//registry.npmjs.org/:_authToken=\${NPM_TOKEN}\\n' : '');
  assert.ok(!process.env.NPM_CONFIG_USERCONFIG.startsWith(path.dirname(process.env.STUB_MANIFEST)));
}
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({tool, args, userconfig: process.env.NPM_CONFIG_USERCONFIG}) + '\\n');
if (tool === 'npm' && args[0] === 'publish') { assert.ok(args.includes('--dry-run')); console.log('{}'); }
else if (tool === 'npm' && args[0] === 'stage' && args[1] === 'list') console.log('[]');
else if (tool === 'npm' && args[0] === 'stage' && args[1] === 'publish') console.log(JSON.stringify({[m.name]: {...m, stageId: '11111111-2222-4333-8444-555555555555'}}));
else if (tool === 'npm' && args[0] === 'stage' && args[1] === 'download') {
  const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(process.env.STUB_MANIFEST), 'release.json')));
  assert.equal(receipt.status, 'staged-unverified');
  assert.equal(receipt.stageId, args[2]);
  fs.copyFileSync(path.join(path.dirname(process.env.STUB_MANIFEST), m.file), 'downloaded.tgz');
}
else if (tool === 'npm' && args[0] === 'view') console.log(JSON.stringify(args[1].endsWith('@0.1.0') ? {version: m.version, 'dist.integrity': m.integrity} : m.version));
else if (tool === 'npm' && args[0] === 'run' && args[1] === 'test:registry') assert.deepEqual(args, ['run', 'test:registry', '--', m.version]);
else if (tool === 'curl') {
  const output = args[args.indexOf('--output') + 1];
  const headers = fs.readFileSync(args[args.indexOf('--header') + 1].slice(1), 'utf8');
  assert.ok(headers.startsWith('Authorization: Bearer synthetic-release-credential\\n'));
  if (args.at(-1).includes('/releases/tags/')) { fs.writeFileSync(output, '{}'); process.stdout.write('404'); }
  else { fs.writeFileSync(output, JSON.stringify({id: 123, assets: []})); process.stdout.write('201'); }
} else throw new Error('Unexpected release operation: ' + tool + ' ' + args.join(' '));
`);
    for (const tool of ["npm", "curl"]) {
      const path = join(bins, tool + (process.platform === "win32" ? ".cmd" : ""));
      await writeFile(path, process.platform === "win32" ? `@"${process.execPath}" "${stub}" ${tool} %*\r\n` : `#!/bin/sh\nexec '${process.execPath}' '${stub}' ${tool} "$@"\n`);
      await chmod(path, 0o755);
    }
    // Restore only from the already-cached Cake packages, without network sources.
    run("dotnet", ["build", "build", "--source", join(temp, "nuget"), "--nologo"]);
    const driver = [join(fixture, "build", "bin", "Debug", "net10.0", "Build.dll")];
    // WHAT: Regression: Stage --dry-run skipped cleanliness checks but still created a stage.
    // HOW: Run that exact Cake entrypoint and require rejection before npm is invoked.
    // Independent review approved this single safety regression's maintenance cost.
    const dryStage = spawnSync("dotnet", [...driver, "--target", "Stage", "--exclusive", "--release-version", "0.1.0", "--dry-run"],
      { cwd: fixture, env, encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.notEqual(dryStage.status, 0, "Stage --dry-run must not create a live stage.");
    await assert.rejects(readFile(log));
    for (const [target, status] of [["DryRun", "dry-run-verified"], ["Stage", "awaiting-2fa-approval"], ["VerifyRegistry", "published-verified"]]) {
      run("dotnet", [...driver, "--target", target, "--exclusive", "--release-version", "0.1.0", ...(target === "DryRun" ? ["--dry-run"] : [])]);
      const receipt = JSON.parse(await readFile(join(fixture, "output", "release", "release.json"), "utf8"));
      assert.equal(receipt.status, status);
      assert.equal(receipt.revision, manifest.commit);
      assert.equal(receipt.integrity, manifest.integrity);
      if (target === "Stage") assert.equal(receipt.stageId, "11111111-2222-4333-8444-555555555555");
    }
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(calls.some(call => call.args.slice(0, 2).join(" ") === "stage download"));
    assert.equal(calls.filter(call => call.args.slice(0, 2).join(" ") === "stage publish").length, 1);
    for (const call of calls) {
      if (call.tool === "npm" && call.args[0] === "publish") assert.ok(call.args.includes("--dry-run"));
      if (call.userconfig) await assert.rejects(readFile(call.userconfig));
    }
    const source = (await Promise.all(["Program.cs", "Tasks.cs", "Release.cs"].map(file => readFile(join(root, "build", file), "utf8")))).join("\n");
    const directPublishes = [...source.matchAll(/\["publish",[^\]]+\]/g)];
    assert.equal(directPublishes.length, 1);
    assert.ok(directPublishes[0][0].includes('"--dry-run"'));
    assert.ok(!source.includes('"approve"'));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
