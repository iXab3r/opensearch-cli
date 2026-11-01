import { parse } from "yaml";

const METHODS = ["get", "put", "post", "delete", "head", "patch", "options"];

/** Compares dotted versions such as "2.7" and "3.0". */
export function compareVersions(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function minVersion(values) {
  const present = values.filter((value) => value !== undefined);
  return present.length === 0 ? null : present.sort(compareVersions)[0];
}

/** True when at least one endpoint of the operation exists in the given major version. */
export function availableIn(endpoints, major) {
  return endpoints.some((endpoint) => {
    const added = endpoint.added ?? "0";
    const addedOk = compareVersions(added, `${major + 1}.0`) < 0;
    const removedOk = endpoint.removed === null || compareVersions(endpoint.removed, `${major}.0`) > 0;
    return addedOk && removedOk;
  });
}

/**
 * Builds the inventory from namespace files: [{ name, text }].
 * One item per logical operation (x-operation-group), not per path/method.
 */
export function buildInventory(files, source) {
  const groups = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const document = parse(file.text);
    const namespace = file.name.replace(/\.yaml$/, "");
    const operations = new Map();
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of METHODS) {
        const op = item?.[method];
        if (!op || typeof op !== "object" || !op["x-operation-group"]) continue;
        const id = op["x-operation-group"];
        if (!operations.has(id)) {
          operations.set(id, { id, descriptions: [], docs: new Set(), endpoints: [] });
        }
        const entry = operations.get(id);
        if (op.description) entry.descriptions.push(op.description.trim());
        if (op.externalDocs?.url) entry.docs.add(op.externalDocs.url);
        entry.endpoints.push({
          method: method.toUpperCase(),
          path,
          added: op["x-version-added"] === undefined ? null : String(op["x-version-added"]),
          deprecated: op["x-version-deprecated"] === undefined ? null : String(op["x-version-deprecated"]),
          removed: op["x-version-removed"] === undefined ? null : String(op["x-version-removed"]),
        });
      }
    }
    const items = [...operations.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((entry) => {
        const endpoints = entry.endpoints.sort((a, b) =>
          a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
        return {
          id: entry.id,
          description: entry.descriptions[0] ?? null,
          docs: [...entry.docs].sort(),
          endpoints,
          added: minVersion(endpoints.map((e) => e.added ?? undefined)),
          deprecated: endpoints.every((e) => e.deprecated !== null)
            ? minVersion(endpoints.map((e) => e.deprecated)) : null,
          availability: Object.fromEntries(source.supportedMajors.map((major) =>
            [`${major}.x`, availableIn(endpoints, major)])),
        };
      });
    if (items.length === 0) continue;
    groups.push({
      name: namespace,
      title: document.info?.title ?? namespace,
      file: `${source.namespacesPath}/${file.name}`,
      operations: items,
    });
  }
  return {
    source: { repository: source.repository, revision: source.revision },
    supportedMajors: source.supportedMajors,
    counts: {
      groups: groups.length,
      operations: groups.reduce((sum, group) => sum + group.operations.length, 0),
    },
    groups,
  };
}
