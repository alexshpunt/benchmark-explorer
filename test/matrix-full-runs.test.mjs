import assert from "node:assert/strict";
import test from "node:test";
import { createMatrix, matrixPartialCoverage } from "../modules/matrix.mjs";

const row = (score, fullBenchmark, taskCount, runId, version = "1.0.0") => ({
  modelFamily: "model", provider: "provider", harnessFamily: "harness", harnessVersion: version,
  runId, configurationHash: runId, score, firstExactRate: score, finalExactRate: score,
  fullBenchmark, taskCount, observations: taskCount,
  cost: { total: taskCount, observations: taskCount },
  tokens: { total: taskCount * 10, observations: taskCount },
  durationSummary: { averageCase: 1 },
});
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const matrix = (rows) => createMatrix({ configurations: rows }, { mean, OVERALL: "Overall" });

test("partial runs do not give a cell a score or any measured aggregate", () => {
  const partial = row(0.1, false, 60, "partial");
  const cells = matrix([partial]).matrixCells([partial], [partial], new Set(["harness"]));
  for (const cell of cells) {
    assert.equal(cell.score, null);
    assert.equal(cell.firstExactRate, null);
    assert.equal(cell.finalExactRate, null);
    assert.equal(cell.averageCost, null);
    assert.equal(cell.averageTokens, null);
    assert.equal(cell.qualityPerDollar, null);
  }
});

test("a partial run cannot lower a full cell's score, price, or coverage count", () => {
  const full = row(0.9, true, 226, "complete");
  const partial = row(0.1, false, 60, "partial");
  const cells = matrix([full, partial]).matrixCells([full, partial], [full], new Set(["harness"]));
  for (const cell of cells) {
    assert.equal(cell.score, 0.9);
    assert.equal(cell.firstExactRate, 0.9);
    assert.equal(cell.averageCost, 1);
    assert.equal(cell.observations, 226);
  }
});

test("a missing score shows the most complete single run, not the sum of partial runs", () => {
  const partials = [row(0.1, false, 60, "one"), row(0.2, false, 120, "two")];
  assert.deepEqual(matrixPartialCoverage(partials, 226), { count: 120, total: 226 });
  assert.equal(matrixPartialCoverage([row(0.9, true, 226, "full"), ...partials], 226), null);
});
