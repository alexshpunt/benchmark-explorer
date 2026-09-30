import assert from "node:assert/strict";
import test from "node:test";
import { baselineHarnessScores, combinationScore, modelRowsScore } from "../modules/scoring.mjs";
import { summaryLeaderboards } from "../modules/summary-leaderboards.mjs";

const row = (modelFamily, harnessFamily, score, runId, harnessVersion = "1") => ({
  modelFamily, harnessFamily, score, runId, harnessVersion, provider: "p", fullBenchmark: true,
});

test("repeating the best harness cannot increase its vote in the model rating", () => {
  const rows = [row("m", "good", 1, "g"), row("m", "bad", 0.2, "b"), row("m", "mid", 0.4, "c")];
  assert.equal(modelRowsScore(rows), 0.4);
  for (let i = 0; i < 20; i++) rows.push(row("m", "good", 1, `g${i}`));
  assert.equal(modelRowsScore(rows), 0.4);
  assert.equal(summaryLeaderboards(rows).models[0].score, 0.4);
});

test("leaderboard harness scores match the matrix rating API with per-route versions", () => {
  const rows = [row("a", "baseline-agent", 0.9, "b1"), row("b", "baseline-agent", 0.7, "b2"),
    row("a", "h", 0.95, "h1", "2"), row("b", "h", 0.6, "h2", "1"),
    row("outside", "h", 1, "out")];
  const rating = baselineHarnessScores(rows).harnesses.get("h");
  const summary = summaryLeaderboards(rows).harnesses.find((item) => item.name === "h");
  assert.equal(summary.score, rating.score);
  assert.equal(summary.coverage, 1);
  assert.equal(summary.combinations, 2);
  assert.ok(Math.abs(rating.score - 0.775) < 1e-10);
});

test("zero scores stay real and repeated configuration rows do not add run votes", () => {
  const rows = [row("m", "h", 0, "a"), row("m", "h", 1, "b")];
  rows.push({ ...rows[0] });
  assert.equal(combinationScore(rows), 0.5);
});
