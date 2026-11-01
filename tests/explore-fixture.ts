import type test from "node:test";
import { setupServer } from "msw/node";
import { createCli } from "@eyeauras/cli-factory";
import { createCliFixture } from "@eyeauras/cli-factory/testing";
import { createDefinition } from "../src/cli.js";

export const origin = "https://cluster.example.com";
/** Real command tree with isolated profile storage and the synthetic native-fetch boundary. */
export async function setupExplore(t: test.TestContext) {
  const fixture = await createCliFixture(t, { applicationId: "opensearch-cli", profiles: [
    { name: "default", values: { url: origin + "/search/", auth: "none" } },
  ] });
  const server = setupServer();
  server.listen({ onUnhandledFrame: "error" });
  t.after(() => server.close());
  const app = fixture.createApplication(runtime => createCli({ ...createDefinition(), runtime }));
  return { fixture, server, app };
}
