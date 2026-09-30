import assert from "node:assert/strict";
import test from "node:test";
import { communityOverview, typicalRange } from "../modules/community.mjs";

const row = (modelFamily, runId, cost = 1, duration = 600) => ({
  modelFamily, provider: "p", runId, harnessFamily: "h", harnessVersion: "1", thinking: "low",
  fullBenchmark: true, score: 0.9, observations: 10,
  cost: { observations: 10, total: cost }, duration: { observations: 10, total: duration },
});

test("typical ranges exclude invalid and zero totals and use P10–P90, not extremes", () => {
  assert.deepEqual(typicalRange([0, null, NaN, -1, 1, 2, 3, 4, 100]),
    { median: 3, low: 1.4, high: 61.60000000000001, count: 5 });
  assert.equal(typicalRange([0, NaN]), null);
});

test("multi-model batches count separately; duplicates and partial results do not inflate contributions", () => {
  const rows = [row("a", "batch"), row("b", "batch", 2), row("c", "other", 3),
    { ...row("partial", "batch"), fullBenchmark: false }];
  rows.push({ ...rows[0] });
  const snapshot = { runRows: { all: rows }, index: { runs: [
    { runId: "batch", submissionId: "s1", submittedBy: { accountId: "alex", profileUrl: "https://github.com/alex" } },
    { runId: "other", submissionId: "s2", submittedBy: { accountId: "bea" } },
  ] } };
  const result = communityOverview(snapshot);
  assert.deepEqual(result.contributors.map((person) => [person.name, person.results, person.submissions.size]),
    [["alex", 2, 1], ["bea", 1, 1]]);
  assert.equal(result.cost.count, 3);
  assert.equal(result.cost.median, 2);
});

test("cost and duration require independent complete measurement and keep separate sample counts", () => {
  const incomplete = row("a", "r");
  incomplete.cost.observations = 9;
  const snapshot = { runRows: { all: [incomplete, row("b", "r", 0, 0), row("c", "r", 2, 1200)] },
    index: { runs: [{ runId: "r" }] } };
  const result = communityOverview(snapshot);
  assert.equal(result.cost.count, 1);
  assert.equal(result.duration.count, 2);
  assert.deepEqual(result.contributors, []);
});
