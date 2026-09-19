import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateGroupScore,
  explorerSearch,
  moveColumn,
  normalizeColumnLayout,
  observedMetricAverage,
  parseExplorerControls,
  qualityPerDollar,
  relativeQualityPosition,
} from "../core.mjs";

const columns = ["#", "score", "model", "provider", "avgCost($)", "avgTokens"];

test("saved leaderboard layout keeps known columns once and restores new columns", () => {
  assert.deepEqual(
    normalizeColumnLayout(
      columns,
      {
        version: 1,
        order: ["avgCost($)", "model", "ghost", "score", "avgCost($)"],
        hidden: ["provider", "model", "ghost"],
      },
      ["model"],
    ),
    {
      version: 1,
      order: ["avgCost($)", "model", "score", "#", "provider", "avgTokens"],
      hidden: ["provider"],
    },
  );
});

test("malformed leaderboard layout falls back to the complete default", () => {
  assert.deepEqual(normalizeColumnLayout(columns, "broken", ["model"]), {
    version: 1,
    order: columns,
    hidden: [],
  });
});

test("columns can move before or after a drop target", () => {
  assert.deepEqual(moveColumn(["a", "b", "c", "d"], "b", "c", true), ["a", "c", "b", "d"]);
  assert.deepEqual(moveColumn(["a", "b", "c", "d"], "b", "d", true), ["a", "c", "d", "b"]);
  assert.deepEqual(moveColumn(["a", "b", "c", "d"], "d", "b", false), ["a", "d", "b", "c"]);
});

test("every matrix metric, including Score, has a deterministic shareable URL", () => {
  assert.equal(explorerSearch({}, { matrixMetric: "avgCost" }), "?metric=avgCost");
  assert.equal(explorerSearch({}, { matrixMetric: "score" }), "?metric=score");
  assert.equal(parseExplorerControls("?metric=avgCost").matrixMetric, "avgCost");
  assert.equal(parseExplorerControls("?metric=made-up").matrixMetric, "score");
});

test("first exact aggregation is weighted by the trials it describes", () => {
  const group = aggregateGroupScore([
    { observations: 10, firstExactRate: 1, finalExactRate: 1, score: 1 },
    { observations: 100, firstExactRate: 0, finalExactRate: 0, score: 0 },
  ]);
  assert.equal(group.firstExactRate, 10 / 110);
});

test("observed matrix averages pool only reported trials", () => {
  const rows = [
    { cost: { total: 4, observations: 2 } },
    { cost: { total: 9, observations: 3 } },
    { cost: { total: 0, observations: 0 } },
  ];
  assert.equal(observedMetricAverage(rows, "cost"), 13 / 5);
  assert.equal(observedMetricAverage([{ cost: { total: 0, observations: 0 } }], "cost"), null);
});

test("an equal metric range is neutral for both quality directions", () => {
  assert.equal(relativeQualityPosition(4, 4, 4, true), 0.5);
  assert.equal(relativeQualityPosition(4, 4, 4, false), 0.5);
  assert.equal(relativeQualityPosition(1, 1, 3, true), 0);
  assert.equal(relativeQualityPosition(1, 1, 3, false), 1);
});

test("quality per dollar rejects missing and non-positive cost", () => {
  assert.equal(qualityPerDollar(98.5, 0.5), 197);
  assert.equal(qualityPerDollar(98.5, null), null);
  assert.equal(qualityPerDollar(98.5, 0), null);
});
