import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run through npm run test:package or test:registry.");
const tarball = process.argv[2] === "--tarball" ? process.argv[3] : undefined;
const version = tarball === undefined ? process.argv[2] : undefined;
assert.ok(tarball === undefined || isAbsolute(tarball), "Pass an absolute tarball path.");
assert.ok(version === undefined || /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version), "Pass a registry version.");
const temp = await realpath(await mkdtemp(join(tmpdir(), "opensearch-package-")));
const prefix = join(temp, "prefix");
const working = join(temp, "working");
const windows = process.platform === "win32";
const modules = join(prefix, ...(windows ? [] : ["lib"]), "node_modules");
const bins = windows ? prefix : join(prefix, "bin");
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(npm_config_|npm_token$|node_auth_token$|gh_token$|github_token$|node_options$|node_path$|opensearch_)/i.test(key)) delete env[key];
}
const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
env[pathKey] = bins + delimiter + (env[pathKey] ?? "");
function run(executable, argv, options = {}) {
  const result = spawnSync(executable, argv, { cwd: working, env, encoding: "utf8", timeout: 180_000, windowsHide: true, ...options });
  assert.ok(!result.error && result.status === 0, `Package check failed (status ${result.status}, ${result.error?.code ?? "process exit"}).`);
  return result.stdout;
}
function npm(argv, options) {
  return run(process.execPath, [npmCli, ...argv, "--cache", join(temp, "cache"), "--userconfig", join(temp, "npmrc"),
    "--globalconfig", join(temp, "global-npmrc"), "--registry", "https://registry.npmjs.org/"], options);
}
function command(argv, input) {
  return windows
    ? run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `opensearch-cli.cmd ${argv.join(" ")}`], { input })
    : run(join(bins, "opensearch-cli"), argv, { input });
}
try {
  await Promise.all([mkdir(working), writeFile(join(temp, "npmrc"), ""), writeFile(join(temp, "global-npmrc"), "")]);
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  let source = tarball ?? `${metadata.name}@${version}`;
  if (version === undefined && tarball === undefined) {
    const [packed] = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", temp], { cwd: root }));
    const files = new Set(packed.files.map(file => file.path));
    for (const path of ["package.json", "LICENSE", "README.md", "dist/src/bin.js", "dist/src/index.js", "dist/src/index.d.ts"]) assert.ok(files.has(path), `Missing ${path}`);
    for (const path of files) assert.ok(["package.json", "LICENSE", "README.md"].includes(path) || /^dist\/src\/[\w/-]+\.(js|d\.ts)$/.test(path), `Unexpected package member: ${path}`);
    source = join(temp, packed.filename);
  }
  npm(["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", source]);
  const installed = await realpath(join(modules, "@eyeauras", "opensearch-cli"));
  assert.ok(!relative(prefix, installed).startsWith(".."));
  const installedMetadata = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  assert.equal(installedMetadata.version, version ?? metadata.version);
  assert.match(command(["--help"]), /Usage: opensearch-cli/);
  assert.equal(command(["--version"]).trim(), installedMetadata.version);
  const requests = [1, 2].map(id => JSON.stringify({ jsonrpc: "2.0", id, method: "cli.execute", params: { argv: ["--help"] } })).join("\n") + "\n";
  const replies = command(["--json-rpc"], requests).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(replies.map(reply => reply.id), [1, 2]);
  for (const reply of replies) assert.ok(reply.result);
  const resolved = JSON.parse(run(process.execPath, ["--input-type=module", "--eval", 'console.log(JSON.stringify(import.meta.resolve("@eyeauras/cli-factory")))'], { cwd: installed }));
  assert.ok(!relative(prefix, await realpath(fileURLToPath(resolved))).startsWith(".."), "Framework must resolve inside the installed prefix.");
  console.log("Packed files, isolated install, executable, version and persistent RPC passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
