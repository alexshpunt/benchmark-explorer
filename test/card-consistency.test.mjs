import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app.mjs", import.meta.url), "utf8");

test("configuration cards cannot replace the shared title and identity", () => {
  assert.match(source, /function openConfigurationDetails\(rows\) \{/u);
  assert.doesNotMatch(source, /function openConfigurationDetails\(rows, title, identity\)/u);
});

test("model and harness cards render Dataset-provided source links", () => {
  assert.match(source, /state\.views\?\.sources\?\.models/u);
  assert.match(source, /state\.views\?\.sources\?\.harnesses/u);
  assert.match(source, /"Official model page"/u);
  assert.match(source, /"npm package"/u);
  assert.match(source, /Repository: source\?\.repositoryUrl/u);
});
test("a harness card shows its version once", () => {
  assert.match(source, /title: `Harness: \$\{harness\}`/u);
  assert.match(source, /identity: version \? `Version \$\{compactVersion\(version\)\}`/u);
});

test("a harness card shows the latest complete version badge beside a selected version", () => {
  assert.match(source, /`Badge score \(latest complete: \$\{badgeVersion\}\)`/u);
  assert.match(source, /summary\[0\]\[0\] = "Version score"/u);
  assert.match(source, /family\?\.harnessVersion/u);
  assert.match(source, /state\.views\?\.badges\?\.harnessFamily/u);
});
