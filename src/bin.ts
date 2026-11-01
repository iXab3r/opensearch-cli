#!/usr/bin/env node
import { createCli } from "@eyeauras/cli-factory";
import { createDefinition } from "./cli.js";

const app = createCli(createDefinition());
try {
  process.exitCode = await app.run();
} finally {
  await app.dispose();
}
