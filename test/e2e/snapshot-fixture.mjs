import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { aggregateRunConfigurations, markFullBenchmarkRows } from "../../core.mjs";

/** Build a checked browser snapshot from run/harness/version/reasoning/pass-count/task-count/model tuples. */
export function snapshotFixture(cases) {
  const revision = "a".repeat(40);
  const taskIds = Array.from({ length: 10 }, (_, index) => `edit/task-${index}`);
  const index = { schemaVersion: 1, runs: cases.map(([runId]) => ({ runId,
    definitions: { taskSet: { taskIds } }, benchmark: { id: "explicit-edit", version: "1" } })) };
  const profiles = cases.map(([runId, harnessFamily, harnessVersion, thinking, _passes, _tasks, modelFamily = "m"]) => ({
    runId, profileId: "profile", configurationHash: runId, modelFamily, provider: "p", thinking,
    harnessFamily, harnessVersion, harnessId: harnessFamily, agentFamily: "pi", agentVersion: "1",
  }));
  const trials = cases.flatMap(([runId, _harness, _version, _thinking, passes, taskLimit = 10]) => taskIds.slice(0, taskLimit).map((taskId, task) => ({
    runId, profileId: "profile", trialId: `${runId}-${task}`, taskId, rounds: 1,
    firstExactPassed: task < passes, finalExactPassed: task < passes,
  })));
  const rounds = trials.map((trial) => ({ runId: trial.runId, trialId: trial.trialId,
    roundId: trial.trialId, seconds: 30, costUsd: 0.01, totalTokens: 100 }));
  const rows = aggregateRunConfigurations(index, profiles, trials, rounds);
  const views = { schemaVersion: 1, scoring: { id: "explicit-edit-score", version: 2 }, leaderboard: rows,
    taskFamilies: {}, sources: { models: {}, harnesses: {} } };
  const runRows = { all: rows };
  views.fullRunKeys = markFullBenchmarkRows(runRows, views);
  const acceptedRuns = rows.map((row) => ({ runId: row.runId, acceptedAt: "2026-09-30T00:00:00Z", score: row.score }));
  const bytes = gzipSync(JSON.stringify({ schemaVersion: 1, revision, index, views, runRows, acceptedRuns,
    recentRuns: acceptedRuns.slice(0, 8), profiles, trials, rounds, toolCounts: [] }));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = { schemaVersion: 1, revision, file: `snapshots/snapshot.${sha256}.json.gz`, sha256, trials: trials.length };
  return { bytes, manifest };
}
