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
