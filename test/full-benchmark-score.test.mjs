import assert from "node:assert/strict";
import test from "node:test";
import { aggregateGroupScore, fullBenchmarkRun, markFullBenchmarkRows,
  aggregateLeaderboard, setViewsData } from "../core.mjs";

test("one-task runs are not full even when their declared task set has one task", () => {
  const partial = { runId: "short", configurationHash: "short-hash", taskCount: 1,
    benchmarkTaskCount: 1, complete: true, coverage: 1, score: 0.004, observations: 1 };
  const complete = { runId: "long", configurationHash: "long-hash", taskCount: 226,
    benchmarkTaskCount: 226, complete: true, coverage: 1, score: 0.99, observations: 226 };
  const runRows = { all: [partial, complete], "Language edits": [{ ...partial }, { ...complete }] };
  const views = { leaderboard: [{ benchmarkTaskCount: 226 }] };
  assert.deepEqual(markFullBenchmarkRows(runRows, views), ["long\tlong-hash"]);
  assert.equal(fullBenchmarkRun(partial), false);
  assert.equal(fullBenchmarkRun(complete), true);
  assert.equal(runRows["Language edits"][0].fullBenchmark, false);
  assert.equal(aggregateGroupScore(runRows.all).score, 0.99);
  assert.equal(aggregateGroupScore([partial]).score, null);
});

test("published partial configurations stay visible, without a leaderboard summary score", () => {
  setViewsData({ schemaVersion: 1, leaderboard: [
    { modelFamily: "model", harnessFamily: "harness", score: 0.004,
      runIds: ["short"], configurationHashes: ["short-hash"] },
  ], fullRunKeys: [], taskFamilies: {} });
  const [row] = aggregateLeaderboard(null, null, null, null);
  assert.equal(row.score, 0.004);
  assert.equal(row.fullBenchmark, false);
});
