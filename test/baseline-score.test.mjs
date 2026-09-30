import assert from "node:assert/strict";
import test from "node:test";
import { baselineHarnessScores } from "../modules/scoring.mjs";

const full = (model, provider, harness, version, runId, score) => ({
  modelFamily: model, provider, harnessFamily: harness, harnessVersion: version,
  runId, score, fullBenchmark: true,
});

test("specification example keeps a fixed M, imputes missing only in totals, and survives display switches", async () => {
  const { matrixDisplayCells } = await import("../modules/matrix.mjs");
  const rows = [
    full("Luna", "p", "baseline-agent", "1", "b1", 0.9),
    full("Kimi", "p", "baseline-agent", "1", "b2", 0.7),
    full("GLM", "p", "baseline-agent", "1", "b3", 0.4),
    full("Luna", "p", "A", "1", "a1", 0.94),
    full("Luna", "p", "A", "1", "a2", 0.96),
    full("GLM", "p", "A", "1", "a3", 0.35),
    full("Luna", "p", "pi-default", "1", "p1", 0.95),
    full("outside", "p", "A", "1", "outside", 0.99),
    { ...full("partial", "p", "baseline-agent", "1", "partial", 0.9), fullBenchmark: false },
  ];
  const original = structuredClone(rows);
  const calculate = (data) => baselineHarnessScores(data, data.map((row) => row.runId));
  const scores = calculate(rows);
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10);
  assert.equal(scores.models, 3);
  close(scores.baselineMean, 2 / 3);
  close(scores.harnesses.get("baseline-agent").score, 2 / 3);
  assert.equal(scores.harnesses.get("baseline-agent").delta, 0);
  close(scores.harnesses.get("A").score, 2 / 3);
  close(scores.harnesses.get("A").delta, 0);
  assert.equal(scores.harnesses.get("A").covered, 2);
  close(scores.harnesses.get("A").coverage, 2 / 3);
  close(scores.harnesses.get("pi-default").coverage, 1 / 3);
  assert.equal(scores.harnesses.get("baseline-agent").coverage, 1);
  close(scores.harnesses.get("pi-default").score, 0.6833333333333333);
  close(scores.harnesses.get("pi-default").delta, 0.05 / 3);
  assert.equal(scores.harnesses.get("pi-default").covered, 1);
  assert.equal(scores.harnesses.get("A").rows.some((row) => row.modelFamily === "Kimi"), false);
  const added = calculate([...rows, full("outside", "p", "new", "1", "new", 0.1)]);
  assert.deepEqual(added.baselines, scores.baselines);
  assert.deepEqual(added.harnesses.get("A"), scores.harnesses.get("A"));
  const cells = [...scores.baselines.keys(), "outside\tp", "partial\tp", "Luna\tother-provider"]
    .map((model) => ({ model, score: null }));
  const before = structuredClone(scores);
  assert.equal(matrixDisplayCells(cells, scores).length, 3);
  assert.equal(matrixDisplayCells(cells, scores, false).length, 6);
  assert.equal(matrixDisplayCells(cells, scores, true).length, 3);
  assert.deepEqual(scores, before);
  assert.ok(cells.every((cell) => cell.score === null));
  assert.deepEqual(rows, original);
});
test("baseline repeats share one route vote and use the latest run's version", () => {
  const rows = [
    full("a", "p", "baseline-agent", "1", "b1", 0.6),
    full("a", "p", "baseline-agent", "0", "old", 0.1),
    full("a", "p", "baseline-agent", "1", "b2", 1),
    full("b", "p", "baseline-agent", "1", "b3", 0.4),
  ];
  const scores = baselineHarnessScores(rows, rows.map((row) => row.runId));
  assert.equal(scores.models, 2);
  assert.equal(scores.baselines.get("a\tp").score, 0.8);
  assert.ok(Math.abs(scores.baselineMean - 0.6) < 1e-10);
});
test("the default baseline is baseline-agent, not pi-default", () => {
  const rows = [
    full("a", "p", "baseline-agent", "1", "b", 0.8),
    full("a", "p", "pi-default", "1", "p", 0.5),
    full("extra", "p", "pi-default", "1", "extra", 0.1),
  ];
  const scores = baselineHarnessScores(rows, rows.map((row) => row.runId));
  assert.equal(scores.baselineHarness, "baseline-agent");
  assert.equal(scores.models, 1);
  assert.equal(scores.baselineMean, 0.8);
  assert.equal(scores.harnesses.get("baseline-agent").delta, 0);
  assert.ok(Math.abs(scores.harnesses.get("pi-default").delta + 0.3) < 1e-10);
});
test("missing routes inherit their own baseline and every provider route gets one vote", () => {
  const rows = [
    full("luna", "a", "baseline-agent", "1", "b1", 0.9),
    full("luna", "b", "baseline-agent", "1", "b2", 0.7),
    full("glm", "c", "baseline-agent", "1", "b3", 0.4),
    full("luna", "a", "other", "2", "h1", 0.95),
    full("luna", "a", "other", "2", "h2", 0.85),
    full("glm", "c", "other", "2", "h3", 0.35),
  ];
  const scores = baselineHarnessScores(rows, rows.map((row) => row.runId));
  assert.equal(scores.models, 3);
  assert.ok(Math.abs(scores.baselineMean - 2 / 3) < 1e-10);
  assert.ok(Math.abs(scores.harnesses.get("other").score - 0.65) < 1e-10);
  assert.equal(scores.harnesses.get("other").covered, 2);
  assert.deepEqual(scores.harnesses.get("other").models, ["luna\ta", "glm\tc"]);
  assert.equal(scores.harnesses.get("baseline-agent").delta, 0);
});

test("the latest complete version is selected independently per route", () => {
  const rows = [
    full("a", "p", "baseline-agent", "1", "b1", 0.5),
    full("b", "p", "baseline-agent", "2", "b2", 0.6),
    full("a", "p", "baseline-agent", "3", "b3", 0.7),
    full("a", "p", "other", "1", "h1", 0.9),
    full("b", "p", "other", "1", "h2", 0.9),
    full("a", "p", "other", "2", "h3", 0.8),
    { ...full("b", "p", "other", "3", "partial", 0.1), fullBenchmark: false },
  ];
  const scores = baselineHarnessScores(rows, rows.map((row) => row.runId));
  const other = scores.harnesses.get("other");
  assert.equal(scores.models, 2);
  assert.equal(other.version, null);
  assert.equal(other.covered, 2);
  assert.ok(Math.abs(other.score - 0.85) < 1e-10);
  assert.equal(scores.baselines.get("a\tp").version, "3");
  assert.equal(scores.baselines.get("b\tp").version, "2");
});

test("another harness can supply the per-route baseline without changing the formula", () => {
  const rows = [full("a", "p", "reference", "1", "r1", 0.4),
    full("b", "p", "reference", "1", "r2", 0.8),
    full("a", "p", "baseline-agent", "1", "p1", 0.5)];
  const scores = baselineHarnessScores(rows, rows.map((row) => row.runId), "reference");
  assert.equal(scores.models, 2);
  assert.ok(Math.abs(scores.harnesses.get("baseline-agent").score - 0.65) < 1e-10);
  assert.equal(scores.harnesses.get("baseline-agent").covered, 1);
});

test("an unbaselined route cannot change the score or its denominator", () => {
  const rows = [
    full("a", "p", "baseline-agent", "1", "b", 0.5),
    full("a", "p", "other", "1", "h", 0.7),
    full("missing", "p", "other", "1", "orphan", 0.01),
  ];
  const scores = baselineHarnessScores(rows, rows.map((row) => row.runId));
  assert.equal(scores.models, 1);
  assert.equal(scores.harnesses.get("other").covered, 1);
  assert.ok(Math.abs(scores.harnesses.get("other").score - 0.7) < 1e-10);
});
