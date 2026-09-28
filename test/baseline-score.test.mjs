import assert from "node:assert/strict";
import test from "node:test";
import { baselineHarnessScores } from "../modules/baseline-score.mjs";

const full = (model, provider, harness, version, runId, score) => ({
  modelFamily: model, provider, harnessFamily: harness, harnessVersion: version,
  runId, score, fullBenchmark: true,
});

test("missing routes inherit their own baseline and every provider route gets one vote", () => {
  const rows = [
    full("luna", "a", "pi-default", "1", "b1", 0.9),
    full("luna", "b", "pi-default", "1", "b2", 0.7),
    full("glm", "c", "pi-default", "1", "b3", 0.4),
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
  assert.equal(scores.harnesses.get("pi-default").delta, 0);
});

test("the latest complete harness version applies globally; baseline stays latest per route", () => {
  const rows = [
    full("a", "p", "pi-default", "1", "b1", 0.5),
    full("b", "p", "pi-default", "2", "b2", 0.6),
    full("a", "p", "pi-default", "3", "b3", 0.7),
    full("a", "p", "other", "1", "h1", 0.9),
    full("b", "p", "other", "1", "h2", 0.9),
    full("a", "p", "other", "2", "h3", 0.8),
    { ...full("b", "p", "other", "3", "partial", 0.1), fullBenchmark: false },
  ];
  const scores = baselineHarnessScores(rows, rows.map((row) => row.runId));
  const other = scores.harnesses.get("other");
  assert.equal(scores.models, 2);
  assert.equal(other.version, "2");
  assert.equal(other.covered, 1);
  assert.ok(Math.abs(other.score - 0.7) < 1e-10);
  assert.equal(scores.baselines.get("a\tp").version, "3");
  assert.equal(scores.baselines.get("b\tp").version, "2");
});

test("another harness can supply the per-route baseline without changing the formula", () => {
  const rows = [full("a", "p", "reference", "1", "r1", 0.4),
    full("b", "p", "reference", "1", "r2", 0.8),
    full("a", "p", "pi-default", "1", "p1", 0.5)];
  const scores = baselineHarnessScores(rows, rows.map((row) => row.runId), "reference");
  assert.equal(scores.models, 2);
  assert.ok(Math.abs(scores.harnesses.get("pi-default").score - 0.65) < 1e-10);
  assert.equal(scores.harnesses.get("pi-default").covered, 1);
});

test("an unbaselined route cannot change the score or its denominator", () => {
  const rows = [
    full("a", "p", "pi-default", "1", "b", 0.5),
    full("a", "p", "other", "1", "h", 0.7),
    full("missing", "p", "other", "1", "orphan", 0.01),
  ];
  const scores = baselineHarnessScores(rows, rows.map((row) => row.runId));
  assert.equal(scores.models, 1);
  assert.equal(scores.harnesses.get("other").covered, 1);
  assert.ok(Math.abs(scores.harnesses.get("other").score - 0.7) < 1e-10);
});
