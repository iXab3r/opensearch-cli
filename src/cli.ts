import type { CliDefinition } from "@eyeauras/cli-factory";
import { version } from "./version.js";

export function createDefinition(): CliDefinition {
  return {
    name: "opensearch-cli",
    description: "Explore and manage OpenSearch clusters",
    version,
    permissions: {},
    commands: [],
  };
}
