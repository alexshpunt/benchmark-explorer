import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateGroupScore,
  aggregateRunConfigurations,
  aggregateToolUsage,
  compareHarnessVersions,
  explorerSearch,
  latestHarnessConfigurations,
  moveColumn,
  normalizeColumnLayout,
  observedMetricAverage,
  parseExplorerControls,
  qualityPerDollar,
  relativeQualityPosition,
  toolTrialCounts,
} from "../core.mjs";
import { DEFAULT_HIDDEN_IDS } from "../modules/leaderboard.mjs";

test("compact leaderboard defaults keep identities, score and total usage visible", () => {
  const visible = ["#", "score", "model", "agent", "totalCost($)", "totalTokens"];
  const all = [...visible, ...DEFAULT_HIDDEN_IDS];
  const layout = normalizeColumnLayout(all, { version: 1, order: all, hidden: DEFAULT_HIDDEN_IDS }, ["model"]);
  assert.deepEqual(layout.order.filter((id) => !layout.hidden.includes(id)), visible);
});

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

test("expanded harness families round-trip through a stable URL", () => {
  assert.deepEqual(parseExplorerControls("?expandHarness=pi&expandHarness=dsh").expandedHarnesses, [
    "pi",
    "dsh",
  ]);
  assert.equal(
    explorerSearch({}, { matrixMetric: "score", expandedHarnesses: ["pi", "dsh", "pi"] }),
    "?metric=score&expandHarness=dsh&expandHarness=pi",
  );
});

test("expanded harness versions sort in semantic order", () => {
  assert.deepEqual(
    ["0.10.0", "0.6.2", "0.6.2-rc.1", "0.5.0"].sort(compareHarnessVersions),
    ["0.5.0", "0.6.2-rc.1", "0.6.2", "0.10.0"],
  );
});

test("compact harness rows use each model's latest version and accepted run", () => {
  const rows = [
    { modelFamily: "a", provider: "p", harnessFamily: "pi", harnessVersion: "0.6.1", runId: "r1" },
    { modelFamily: "a", provider: "p", harnessFamily: "pi", harnessVersion: "0.6.2", runId: "r2" },
    { modelFamily: "a", provider: "p", harnessFamily: "pi", harnessVersion: "0.6.2", runId: "r3" },
    { modelFamily: "b", provider: "p", harnessFamily: "pi", harnessVersion: "0.6.1", runId: "r1" },
  ];
  assert.deepEqual(
    latestHarnessConfigurations(rows, ["r1", "r2", "r3"]).map((row) => [row.modelFamily, row.harnessVersion, row.runId]),
    [
      ["a", "0.6.2", "r3"],
      ["b", "0.6.1", "r1"],
    ],
  );
});

test("run configurations keep repeated accepted runs separate", () => {
  const taskId = (runId) =>
    runId === "r1" ? "language-insert-1-python-plain" : "language-select-10-python-plain";
  const run = (runId) => ({
    runId,
    contract: "bench",
    definitions: {
      benchmark: { id: "bench", version: "1" },
      taskSet: { taskIds: [taskId(runId)] },
    },
  });
  const profile = (runId) => ({
    runId,
    profileId: "profile",
    modelFamily: "model",
    provider: "provider",
    harnessFamily: "pi",
    harnessVersion: "1.0.0",
  });
  const trial = (runId, passed) => ({
    runId,
    profileId: "profile",
    trialId: `${runId}-trial`,
    taskId: taskId(runId),
    firstExactPassed: passed,
    finalExactPassed: passed,
    rounds: 1,
  });
  const round = (runId, costUsd) => ({
    runId,
    trialId: `${runId}-trial`,
    roundId: "round",
    seconds: 1,
    costUsd,
    totalTokens: costUsd * 100,
  });
  const rows = aggregateRunConfigurations(
    { runs: [run("r1"), run("r2")] },
    [profile("r1"), profile("r2")],
    [trial("r1", false), trial("r2", true)],
    [round("r1", 1), round("r2", 2)],
  );
  assert.deepEqual(
    rows.map((row) => [row.runId, row.score, row.cost.total, row.tokens.total]),
    [
      ["r1", 0, 1, 100],
      ["r2", 1, 2, 200],
    ],
  );
});

test("tool usage keeps accepted runs separate for compact cells", () => {
  const runs = ["r1", "r2"].map((runId) => ({
    runId,
    contract: "bench",
    definitions: { benchmark: { id: "bench", version: "1" } },
  }));
  const profiles = runs.map(({ runId }) => ({
    runId,
    profileId: "profile",
    modelFamily: "model",
    provider: "provider",
    harnessFamily: "pi",
    harnessVersion: "1.0.0",
  }));
  const trials = runs.map(({ runId }) => ({
    runId,
    profileId: "profile",
    trialId: `${runId}-trial`,
    taskId: "language-insert-1-python-plain",
  }));
  const rounds = runs.map(({ runId }) => ({
    runId,
    trialId: `${runId}-trial`,
    roundId: `${runId}-round`,
  }));
  const toolCalls = [
    { runId: "r1", roundId: "r1-round", tool: "read" },
    { runId: "r2", roundId: "r2-round", tool: "write" },
  ];
  const usage = aggregateToolUsage({ runs }, profiles, trials, rounds, toolCalls);
  assert.deepEqual(
    usage.map((row) => [row.runId, row.tools[0].tool]),
    [
      ["r1", "read"],
      ["r2", "write"],
    ],
  );
  const detail = toolTrialCounts(
    { runs },
    profiles,
    trials,
    rounds,
    toolCalls,
    "read",
  );
  assert.deepEqual(
    detail.map((row) => [row.runId, row.calls]),
    [
      ["r1", 1],
      ["r2", 0],
    ],
  );
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
