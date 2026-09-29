import assert from "node:assert/strict";
import test from "node:test";
import { summaryLeaderboards } from "../modules/summary-leaderboards.mjs";

const row = (model, provider, harness, version, score, runId, fullBenchmark = true) => ({
  modelFamily: model,
  provider,
  harnessFamily: harness,
  harnessVersion: version,
  score,
  runId,
  fullBenchmark,
});

test("summary leaderboards use one median per latest model and harness combination", () => {
  const rows = [
    row("org/alpha", "one", "h1", "1.0.0", 0.1, "old"),
    row("alpha", "one", "h1", "2.0.0", 0.7, "a1"),
    row("alpha", "two", "h1", "2.0.0", 0.9, "a2"),
    row("alpha", "one", "h2", "1.0.0", 0.5, "a3"),
    row("beta", "one", "h1", "1.0.0", 0.2, "b1"),
    row("beta", "one", "h1", "1.0.0", 0.4, "b2"),
    row("beta", "one", "h2", "3.0.0", 1, "partial", false),
  ];

  const result = summaryLeaderboards(rows);
  assert.deepEqual(result.combinations.map(({ model, harness, version, score, runs }) =>
    [model, harness, version, Number(score.toFixed(3)), runs]), [
    ["alpha", "h1", "2.0.0", 0.8, 2],
    ["alpha", "h2", "1.0.0", 0.5, 1],
    ["beta", "h1", "1.0.0", 0.3, 2],
  ]);
  assert.deepEqual(result.models.map(({ name, score, combinations, runs }) =>
    [name, Number(score.toFixed(3)), combinations, runs]), [
    ["alpha", 0.65, 2, 3],
    ["beta", 0.3, 1, 2],
  ]);
  assert.deepEqual(result.harnesses.map(({ name, score, combinations, runs }) =>
    [name, Number(score.toFixed(3)), combinations, runs]), [
    ["h1", 0.55, 2, 4],
    ["h2", 0.5, 1, 1],
  ]);
});

test("a newer harness version is selected separately for each model family", () => {
  const result = summaryLeaderboards([
    row("alpha", "p", "h", "2.0.0", 0.9, "a"),
    row("beta", "p", "h", "1.0.0", 0.4, "b"),
  ]);
  assert.deepEqual(result.combinations.map(({ model, version }) => [model, version]), [
    ["alpha", "2.0.0"],
    ["beta", "1.0.0"],
  ]);
  assert.equal(result.harnesses[0].score, 0.65);
});
