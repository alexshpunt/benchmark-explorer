import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app.mjs", import.meta.url), "utf8");

test("configuration cards cannot replace the shared title and identity", () => {
  assert.match(source, /function openConfigurationDetails\(rows\) \{/u);
  assert.doesNotMatch(source, /function openConfigurationDetails\(rows, title, identity\)/u);
});

test("a harness card shows its version once", () => {
  assert.match(source, /title: `Harness: \$\{harness\}`/u);
  assert.match(source, /identity: version \? `Version \$\{compactVersion\(version\)\}`/u);
});

test("the pi-agent-ide harness card links to its GitHub project", () => {
  assert.match(source, /"pi-agent-ide": "https:\/\/github\.com\/alexshpunt\/pi-agent-ide"/u);
  assert.match(source, /project: HARNESS_PROJECT_URLS\[harness\]/u);
});
