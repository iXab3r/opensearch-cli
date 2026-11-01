import assert from "node:assert/strict";
import test from "node:test";
import { availableIn, buildInventory, compareVersions } from "./inventory-core.mjs";
import { operationBody, operationLabels, operationMarker } from "./issue-render.mjs";

const source = {
  repository: "https://github.com/example/spec",
  revision: "0123456789abcdef0123456789abcdef01234567",
  namespacesPath: "spec/namespaces",
  supportedMajors: [2, 3],
};

const sample = `
info:
  title: Sample API
paths:
  /_widgets:
    get:
      x-operation-group: widgets.list
      x-version-added: '1.0'
      description: Lists widgets.
      externalDocs:
        url: https://docs.example.org/widgets/list/
    post:
      x-operation-group: widgets.create
      x-version-added: '3.1'
      description: Creates a widget.
  /{index}/_widgets:
    get:
      x-operation-group: widgets.list
      x-version-added: '1.0'
  /_legacy:
    get:
      x-operation-group: widgets.legacy
      x-version-added: '1.0'
      x-version-deprecated: '2.0'
      x-version-removed: '3.0'
`;

test("one item per operation group, sorted, with merged endpoints", () => {
  const inventory = buildInventory([{ name: "widgets.yaml", text: sample }], source);
  assert.deepEqual(inventory.counts, { groups: 1, operations: 3 });
  const [group] = inventory.groups;
  assert.equal(group.title, "Sample API");
  assert.deepEqual(group.operations.map((op) => op.id), ["widgets.create", "widgets.legacy", "widgets.list"]);
  const list = group.operations.find((op) => op.id === "widgets.list");
  assert.deepEqual(list.endpoints.map((e) => `${e.method} ${e.path}`), ["GET /_widgets", "GET /{index}/_widgets"]);
  assert.deepEqual(list.docs, ["https://docs.example.org/widgets/list/"]);
});

test("availability per supported major", () => {
  const [group] = buildInventory([{ name: "widgets.yaml", text: sample }], source).groups;
  const byId = Object.fromEntries(group.operations.map((op) => [op.id, op]));
  assert.deepEqual(byId["widgets.list"].availability, { "2.x": true, "3.x": true });
  assert.deepEqual(byId["widgets.create"].availability, { "2.x": false, "3.x": true });
  assert.deepEqual(byId["widgets.legacy"].availability, { "2.x": true, "3.x": false });
  assert.equal(byId["widgets.legacy"].deprecated, "2.0");
});

test("labels and body carry facts and a stable marker", () => {
  const inventory = buildInventory([{ name: "widgets.yaml", text: sample }], source);
  const [group] = inventory.groups;
  const create = group.operations.find((op) => op.id === "widgets.create");
  assert.deepEqual(operationLabels(group, create, inventory), ["type:api", "api:widgets", "os:3.x-only"]);
  const body = operationBody(group, create, inventory);
  assert.ok(body.startsWith(operationMarker(create)));
  assert.match(body, /\| `POST` \| `\/_widgets` \| 3\.1 \| — \| — \|/);
  assert.match(body, /Available in OpenSearch 2\.x: no · 3\.x: yes/);
  assert.match(body, /opensearch-api-specification@0123456/);
});

test("generation is deterministic regardless of file order", () => {
  const other = "paths:\n  /_a:\n    get:\n      x-operation-group: a.get\n";
  const one = buildInventory([{ name: "widgets.yaml", text: sample }, { name: "a.yaml", text: other }], source);
  const two = buildInventory([{ name: "a.yaml", text: other }, { name: "widgets.yaml", text: sample }], source);
  assert.deepEqual(one, two);
});

test("version helpers", () => {
  assert.ok(compareVersions("2.10", "2.9") > 0);
  assert.equal(compareVersions("3.0", "3"), 0);
  assert.equal(availableIn([{ added: null, removed: null }], 2), true);
});
