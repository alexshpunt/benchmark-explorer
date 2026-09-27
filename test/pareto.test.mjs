import assert from "node:assert/strict";
import test from "node:test";
import { paretoFrontier, paretoPoints } from "../modules/pareto-data.mjs";

const row = (model, provider, harness, score, cost, runId, version = "1.0.0") => ({
  modelFamily: model, provider, harnessFamily: harness, harnessVersion: version,
  score, fullBenchmark: true,
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

test("a summary keeps all scored routes but marks how many priced its cost", () => {
  const measured = row("a", "p", "h1", 0.8, 2, "1");
  const missing = row("a", "p", "h2", 0.9, null, "2");
  const { points } = paretoPoints([cell("a\tp", "h1", [measured]), cell("a\tp", "h2", [missing])]);
  assert.equal(points.filter((p) => p.kind === "route").length, 1);
  const summary = points.find((p) => p.kind === "model");
  assert.ok(Math.abs(summary.score - 0.85) < 1e-10);
  assert.equal(summary.cost, 2);
  assert.equal(summary.pricedRoutes, 1);
  assert.equal(summary.routes, 2);
  assert.deepEqual(summary.range, { low: 0.8, high: 0.9 });
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

test("other harnesses and models never give a single-run combination a whisker", () => {
  const rows = [row("a", "p1", "h1", 0.5, 1, "1"),
    row("a", "p1", "h2", 0.9, null, "2"),
    row("b", "p2", "h1", 0.2, 2, "3"),
    row("a", "p2", "h2", 0.05, 3, "4")];
  const { points } = paretoPoints(rows.map((r) => cell(`${r.modelFamily}\t${r.provider}`, r.harnessFamily, [r])));
  const route = points.find((p) => p.kind === "route" && p.model === "a");
  assert.equal(route.runRange, null);
  assert.equal(points.filter((p) => p.kind === "route").length, 3);
});

test("a combination's center and whisker use distinct full runs of its latest version", () => {
  const old = row("a", "p", "h", 0.1, null, "old", "1.0.0");
  const first = row("a", "p", "h", 0.8, 2, "new-1", "2.0.0");
  const second = row("a", "p", "h", 0.9, 4, "new-2", "2.0.0");
  const point = paretoPoints([cell("a\tp", "h", [old, first, second])]).points
    .find((candidate) => candidate.kind === "route");
  assert.equal(point.version, "2.0.0");
  assert.ok(Math.abs(point.score - 0.85) < 1e-10);
  assert.equal(point.cost, 3);
  assert.equal(point.runs, 2);
  assert.deepEqual(point.runRange, { low: 0.8, high: 0.9 });
  assert.deepEqual(point.cell.sourceRows, [first, second]);
});

test("one run with multiple rows or identical repeats has no whisker", () => {
  const first = row("a", "p", "h", 0.8, 2, "same");
  const second = row("a", "p", "h", 0.9, 4, "same");
  const point = paretoPoints([cell("a\tp", "h", [first, second])]).points
    .find((candidate) => candidate.kind === "route");
  assert.equal(point.runs, 1);
  assert.equal(point.runRange, null);
});

test("virtual node range follows its free dimension, including full runs without prices", () => {
  const modelRuns = [row("a", "p", "h1", 0.5, 1, "1"),
    row("a", "p", "h2", 0.9, 3, "2", "2.0.0"),
    row("a", "p", "h2", 0.1, null, "old", "1.0.0"),
    row("b", "p", "h1", 0.2, 2, "3")];
  const points = paretoPoints([
    cell("a\tp", "h1", [modelRuns[0]]),
    cell("a\tp", "h2", [modelRuns[1], modelRuns[2]]),
    cell("b\tp", "h1", [modelRuns[3]]),
  ]).points;
  assert.deepEqual(points.find((p) => p.kind === "model" && p.model === "a").range,
    { low: 0.1, high: 0.9 });
  assert.deepEqual(points.find((p) => p.kind === "harness" && p.harness === "h1").range,
    { low: 0.2, high: 0.5 });
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
