import assert from "node:assert/strict";
import test from "node:test";
import { matrixHarnessGroup, median, providerMedian } from "../core.mjs";
import { runBatches } from "../core.mjs";

test("matrix pins baseline first and ranks remaining harnesses best to worst", async () => {
  const { matrixHarnessOrder } = await import("../modules/matrix.mjs");
  const scores = { baselineHarness: "baseline-agent", harnesses: new Map([
    ["baseline-agent", { score: 0.9 }], ["best", { score: 0.99 }],
    ["worst", { score: 0.7 }], ["middle", { score: 0.95 }],
    ["rare-best", { score: 0.98 }], ["rare-worst", { score: 0.6 }],
  ]) };
  const groupOf = (harness) => harness.startsWith("rare-") ? "Others" : harness;
  assert.deepEqual(matrixHarnessOrder(
    ["worst", "rare-worst", "middle", "Others", "best", "rare-best", "baseline-agent"],
    scores, groupOf,
  ), ["baseline-agent", "best", "middle", "worst", "Others", "rare-best", "rare-worst"]);
  assert.deepEqual(matrixHarnessOrder(["worst", "best", "middle"], scores, groupOf),
    ["best", "middle", "worst"]);
});
test("preview loads the newest 50 runs in bounded batches", () => {
  const runs = Array.from({ length: 75 }, (_, index) => index);
  const batches = runBatches(runs, 50);
  assert.equal(batches.length, 10);
  assert.deepEqual(batches[0], [25, 26, 27, 28, 29]);
  assert.deepEqual(batches.at(-1), [70, 71, 72, 73, 74]);
  assert.equal(runBatches(runs).flat().length, 75);
});
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
test("batched runs with four or five model results stay outside Others", async () => {
  const { matrixHarnessRunCounts } = await import("../core.mjs");
  const rows = [3, 4, 5].flatMap((count) => Array.from({ length: count }, (_, index) => ({
    harnessFamily: `batch-harness-${count}`,
    runId: `batch-${count}`,
    modelFamily: `model-${index}`,
    provider: "provider",
    fullBenchmark: true,
    score: 0.9,
  })));
  // Duplicate configurations and reasoning variants cannot inflate the count.
  rows.push({ ...rows[0] }, { ...rows[0], reasoning: "high" });
  rows.push({ ...rows[0], modelFamily: "partial-model", fullBenchmark: false });
  const counts = matrixHarnessRunCounts(rows);
  for (const count of [3, 4, 5]) {
    const harness = `batch-harness-${count}`;
    assert.equal(counts.get(harness), count);
    assert.equal(matrixHarnessGroup(harness, counts), count > 3 ? harness : "Others");
  }
});
test("rare harness groups count unique full runs with a strict >3 threshold", async () => {
  const { matrixHarnessRunCounts } = await import("../core.mjs");
  const rows = ["dsh-code", "dsh-standard", "pi-hashline-edit", "pi-better-edit", "codex-cli-default"]
    .flatMap((harnessFamily, index) => Array.from({ length: index === 3 ? 4 : 3 }, (_, runId) =>
      ({ harnessFamily, runId: harnessFamily + runId, fullBenchmark: true, score: 0.9 })));
  rows.push({ ...rows[0] }, { ...rows[0], runId: "partial", fullBenchmark: false });
  const counts = matrixHarnessRunCounts(rows);
  assert.equal(counts.get("dsh-code"), 3);
  assert.equal(matrixHarnessGroup("dsh-code", counts), "Others");
  assert.equal(matrixHarnessGroup("dsh-standard", counts), "Others");
  assert.equal(matrixHarnessGroup("pi-hashline-edit", counts), "pi-extensions");
  assert.equal(matrixHarnessGroup("pi-better-edit", counts), "pi-better-edit");
  assert.equal(matrixHarnessGroup("codex-cli-default", counts), "Others");
  counts.set("dsh-code", 4);
  assert.equal(matrixHarnessGroup("dsh-code", counts), "dsh-code");
});
