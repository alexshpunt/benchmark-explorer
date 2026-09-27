import assert from "node:assert/strict";
import test from "node:test";
import { paretoFrontier, paretoPoints } from "../modules/pareto-data.mjs";

const row = (model, provider, harness, score, cost, runId) => ({
  modelFamily: model, provider, harnessFamily: harness, score, fullBenchmark: true,
  observations: 10, cost: { observations: cost == null ? 9 : 10, total: cost }, runId,
});
const cell = (model, harness, rows) => ({
  model, harness, columnKey: harness, compact: true, key: `${model}:${harness}`,
  score: rows[0].score, sourceRows: rows, observations: 10,
});

test("unpriced runs cannot turn a partly priced configuration into a plotted point", () => {
  const a = row("a", "p", "h", 0.8, 2, "1");
  const b = row("a", "p", "h", 0.9, null, "2");
  const c = cell("a\tp", "h", [a, b]);
  assert.equal(paretoPoints([c]).points.length, 0);
});

test("a summary is not priced from only the routes that reported cost", () => {
  const measured = row("a", "p", "h1", 0.8, 2, "1");
  const missing = row("a", "p", "h2", 0.9, null, "2");
  const { points } = paretoPoints([cell("a\tp", "h1", [measured]), cell("a\tp", "h2", [missing])]);
  assert.equal(points.filter((p) => p.kind === "route").length, 1);
  assert.equal(points.filter((p) => p.kind === "model").length, 0);
});

test("virtual model price and score give providers one vote, while harness uses model medians", () => {
  const rows = [row("a", "p1", "h", 0.2, 1, "1"), row("a", "p2", "h", 0.4, 3, "2"),
    row("b", "p1", "h", 0.9, 5, "3")];
  const { points } = paretoPoints(rows.map((r) => cell(`${r.modelFamily}\t${r.provider}`, "h", [r])));
  const harness = points.find((p) => p.kind === "harness");
  assert.ok(Math.abs(harness.score - 0.6) < 1e-10); // median of a (0.3) and b (0.9)
  assert.equal(harness.cost, 3.5); // median of a (2) and b (5)
  assert.ok(Math.abs(points.find((p) => p.kind === "model" && p.model === "a").score - 0.3) < 1e-10);
  assert.equal(harness.low, 0.2);
  assert.equal(harness.high, 0.9);
});

test("frontier excludes dominated and virtual points; equal prices keep the better score", () => {
  const points = [
    { key: "cheap", kind: "route", cost: 1, score: 0.7 },
    { key: "dominated", kind: "route", cost: 2, score: 0.6 },
    { key: "better", kind: "route", cost: 2, score: 0.8 },
    { key: "best", kind: "route", cost: 4, score: 0.9 },
    { key: "virtual", kind: "model", cost: 0.5, score: 1 },
  ];
  assert.deepEqual(paretoFrontier(points).map((p) => p.key), ["cheap", "better", "best"]);
});
