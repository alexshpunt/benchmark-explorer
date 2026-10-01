import assert from "node:assert/strict";
import test from "node:test";
import { modelRouteIdentity } from "../core.mjs";
import { baselineHarnessScores, scoredCombinations } from "../modules/scoring.mjs";
import { summaryLeaderboards } from "../modules/summary-leaderboards.mjs";
import { createMatrix, matrixDisplayCells } from "../modules/matrix.mjs";

const row = (thinking, harnessFamily, score, runId, harnessVersion = "1", provider = "p") => ({
  modelFamily: "m", provider, thinking, harnessFamily, harnessVersion, score, runId, fullBenchmark: true,
});

test("reasoning variants get separate ratings, newest versions, and exact baseline matches", () => {
  const rows = [row("low", "baseline-agent", 0.4, "b-low"), row("high", "baseline-agent", 0.8, "b-high"),
    row("low", "h", 0.6, "low-a"), row("low", "h", 0.8, "low-b"),
    row("high", "h", 0.9, "high-new", "2"), row("high", "h", 0.1, "high-old"),
    row("xhigh", "h", 1, "outside"), { ...row("low", "h", 1, "partial", "3"), fullBenchmark: false }];
  rows.push({ ...rows[2] });
  const pairs = scoredCombinations(rows).filter((item) => item.harness === "h");
  assert.equal(pairs.length, 3);
  assert.equal(pairs.find((item) => item.route === modelRouteIdentity(rows[2])).version, "1");
  assert.equal(pairs.find((item) => item.route === modelRouteIdentity(rows[4])).score, 0.9);
  const ratings = baselineHarnessScores(rows);
  assert.equal(ratings.models, 2);
  assert.equal(ratings.harnesses.get("h").covered, 2);
  assert.ok(Math.abs(ratings.harnesses.get("h").score - 0.8) < 1e-10);
  assert.ok(!ratings.harnesses.get("h").rows.some((item) => item.thinking === "xhigh"));
  const ranking = summaryLeaderboards(rows);
  const combo = (name) => ranking.combinations.find((item) => item.model === name && item.harness === "h");
  assert.equal(combo("m · low").version, "1");
  assert.equal(combo("m · low").score, 0.7);
  assert.equal(combo("m · high").version, "2");
  assert.equal(combo("m · high").score, 0.9);
  assert.equal(ranking.models.length, 3);
  assert.equal(ranking.harnesses.find((item) => item.name === "h").score, ratings.harnesses.get("h").score);
  const filtered = summaryLeaderboards(rows.filter((item) => item.thinking === "low"), rows);
  assert.equal(filtered.models.length, 1);
  assert.equal(filtered.models[0].name, "m · low");
  assert.equal(filtered.harnesses.find((item) => item.name === "h").score, ratings.harnesses.get("h").score);
});

test("matrix compact versions ignore newer partial results independently for each reasoning", async () => {
  const { latestHarnessConfigurations } = await import("../core.mjs");
  const rows = [row("low", "h", 0.6, "low", "1"), row("high", "h", 0.9, "high", "2"),
    { ...row("low", "h", 1, "partial", "3"), fullBenchmark: false }];
  assert.deepEqual(latestHarnessConfigurations(rows, rows.map((item) => item.runId)).map((item) => item.runId), ["low", "high"]);
});
test("off, unspecified, and a different provider never borrow a low baseline", () => {
  const rows = [row("low", "baseline-agent", 0.4, "b"), row("high", "h", 1, "hi"),
    row("off", "h", 0, "off"), row(null, "h", 0.9, "unknown"), row("low", "h", 1, "other", "1", "q")];
  assert.equal(new Set(rows.map(modelRouteIdentity)).size, 5);
  const ratings = baselineHarnessScores(rows);
  assert.equal(ratings.harnesses.get("h").covered, 0);
  assert.equal(ratings.harnesses.get("h").score, 0.4);
  assert.equal(summaryLeaderboards(rows).combinations.find((item) => item.model === "m · off").score, 0);
  assert.equal(matrixDisplayCells(rows.map((item) => ({ model: modelRouteIdentity(item) })), ratings).length, 1);
});

test("task-family detail fallback matches the same provider and reasoning", async () => {
  const { setViewsData, precomputedFamilyScore } = await import("../core.mjs");
  const low = row("low", "h", 0.6, "low");
  const high = row("high", "h", 0.9, "high");
  const other = row("low", "h", 1, "other", "1", "q");
  setViewsData({ schemaVersion: 1, leaderboard: [], taskFamilies: { edit: [high, other, low] } });
  try { assert.equal(precomputedFamilyScore(low, "edit"), low); }
  finally { setViewsData({ schemaVersion: 1, leaderboard: [], taskFamilies: {} }); }
});
test("one provider with two reasoning modes forms a collapsed model group with distinct evidence", () => {
  const rows = [row("low", "baseline-agent", 0.4, "low"), row("high", "baseline-agent", 0.8, "high")];
  const state = { snapshot: { runRows: { all: rows } }, baselineScores: baselineHarnessScores(rows),
    matrixBaselineOnly: true, matrixGroups: new Set(["model"]), expandedModels: new Set(),
    expandedMatrixGroups: new Set(), configurations: rows };
  const { groupedMatrixCells } = createMatrix(state, {});
  const cells = rows.map((item) => ({ model: modelRouteIdentity(item), harness: "baseline-agent", columnKey: "baseline-agent",
    key: item.runId, compact: true, score: item.score, sourceRows: [item], observations: 1, costObservations: 0, tokenObservations: 0 }));
  assert.equal(groupedMatrixCells(cells).length, 1);
  state.expandedModels.add("m");
  const expanded = groupedMatrixCells(cells);
  assert.equal(expanded.length, 3);
  for (const cell of cells) assert.deepEqual(expanded.find((item) => item.model === cell.model).sourceRows, cell.sourceRows);
  assert.deepEqual(groupedMatrixCells(cells.slice(0, 1)), cells.slice(0, 1));
});
