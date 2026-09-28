import assert from "node:assert/strict";
import test from "node:test";
import { topFiveGroups, rankTopFive } from "../modules/top-five.mjs";

const row = (model, provider, harness, score, cost, options = {}) => ({
  modelFamily: model, provider, harnessFamily: harness, harnessVersion: options.version ?? "1.0.0",
  runId: options.runId ?? `${model}-${harness}`, fullBenchmark: options.fullBenchmark ?? true,
  score, observations: 226, cost: { total: cost ?? 0, observations: cost == null ? 0 : 226 },
});

test("top five needs three independent routes and ignores partial or unpriced costs", () => {
  const rows = [
    row("alpha", "p1", "h1", 0.9, 1),
    row("alpha", "p1", "h2", 0.8, null),
    row("alpha", "p2", "h1", 0.7, 3),
    row("alpha", "p2", "h2", 0.6, 2),
    row("alpha", "p2", "h2", 0.1, 0.01, { fullBenchmark: false }),
    row("beta", "p3", "h1", 1, 0.2),
    row("beta", "p3", "h3", 0.99, 0.3),
    row("alpha", "p1", "pi-default", 0.8, 1),
    row("alpha", "p2", "pi-default", 0.8, 1),
    row("beta", "p3", "pi-default", 0.8, 1),
  ];
  const { models, harnesses } = topFiveGroups(rows, rows.map((item) => item.runId));
  assert.deepEqual(models.map((item) => item.name), ["alpha", "beta"]);
  assert.equal(models[0].routes, 6);
  // Each provider gets one vote after its harness routes are combined.
  assert.equal(models[0].score, 0.75);
  assert.equal(models[0].cost, 1.5); // one vote for each provider after missing cost is excluded
  assert.deepEqual(harnesses.map((item) => item.name), ["h1", "pi-default"]);
  assert.equal(harnesses[0].routes, 3);
  assert.ok(Math.abs(harnesses[0].score - (0.9 + 0.7 + 1) / 3) < 1e-10);
  assert.ok(Math.abs(harnesses[0].delta - (harnesses[0].score - 0.8)) < 1e-10);
});

test("an older harness version cannot fill missing routes in the top five", () => {
  const rows = [
    row("a", "p", "h", 1, 1, { version: "1.0.0", runId: "old" }),
    row("a", "p", "h", 0.7, null, { version: "2.0.0", runId: "new" }),
    row("b", "p", "h", 0.8, 2),
    row("c", "p", "h", 0.9, 3),
    ...["a", "b", "c"].map((model) => row(model, "p", "pi-default", 0.5, 1)),
  ];
  const { harnesses } = topFiveGroups(rows, rows.map((item) => item.runId));
  assert.deepEqual(harnesses.map((item) => item.name), ["pi-default"]);
});

test("balance ranks only fully priced groups and breaks ties by score", () => {
  const groups = [
    { name: "fast", score: 0.99, cost: 10 },
    { name: "cheap", score: 0.8, cost: 1 },
    { name: "middle", score: 0.9, cost: 2 },
    { name: "bad", score: 0.6, cost: 7 },
    { name: "unpriced", score: 1, cost: null },
  ];
  assert.deepEqual(rankTopFive(groups, "score").map((item) => item.name),
    ["unpriced", "fast", "middle", "cheap", "bad"]);
  assert.deepEqual(rankTopFive(groups, "cost").map((item) => item.name),
    ["cheap", "middle", "bad", "fast"]);
  assert.deepEqual(rankTopFive(groups, "balance").map((item) => item.name),
    ["middle", "cheap", "fast", "bad"]);
});
