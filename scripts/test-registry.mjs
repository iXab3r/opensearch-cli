// Shared installed-package checks; this entry point requires a registry version.
import assert from "node:assert/strict";
assert.equal(process.argv.length, 3, "Pass one published version.");
await import("./test-package.mjs");
