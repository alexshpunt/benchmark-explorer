import assert from "node:assert/strict";
import test from "node:test";
import { matrixHarnessGroup, median, providerMedian } from "../core.mjs";

test("provider median ignores missing values and does not weight by trial count", () => {
  assert.equal(median([0.2, 0.9, 0.4]), 0.4);
  assert.equal(median([null, 0.2, 0.8]), 0.5);
  assert.equal(median([null, NaN]), null);
});

test("collapsed cells give each provider one vote even with multiple harness columns", () => {
  const cells = [
    { model: "m\ta", score: 0.1 },
    { model: "m\ta", score: 0.3 },
    { model: "m\ta", score: 0.5 },
    { model: "m\tb", score: 0.9 },
    { model: "m\tc", score: null },
  ];
  assert.equal(providerMedian(cells, "score"), 0.6);
});
test("dataset harness IDs identify the two DeepSeek modes and Pi extensions", () => {
  assert.equal(matrixHarnessGroup("dsh-code"), "DeepSeek");
  assert.equal(matrixHarnessGroup("dsh-standard"), "DeepSeek");
  assert.equal(matrixHarnessGroup("pi-hashline-edit"), "pi-extensions");
  assert.equal(matrixHarnessGroup("d3ara1n-pi-hashline-edit"), "pi-extensions");
  assert.equal(matrixHarnessGroup("personal-pi-extensions-opencode"), "pi-extensions");
  assert.equal(matrixHarnessGroup("pi-default"), "pi-default");
  assert.equal(matrixHarnessGroup("pi-agent-ide"), "pi-agent-ide");
  assert.equal(matrixHarnessGroup("codex-cli-default"), "codex-cli-default");
});
