#!/usr/bin/env node
import { createCli } from "@eyeauras/cli-factory";
import { createDefinition } from "./cli.js";

const app = createCli(createDefinition());
const interrupt = new AbortController();
const onInterrupt = () => interrupt.abort(new Error("Interrupted."));
process.once("SIGINT", onInterrupt);
try {
  process.exitCode = await app.run(process.argv.slice(2), { signal: interrupt.signal });
} finally {
  process.off("SIGINT", onInterrupt);
  await app.dispose();
}
