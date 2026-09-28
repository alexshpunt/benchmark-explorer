import assert from "node:assert/strict";
import test from "node:test";
import { paretoFrontier, paretoPoints, paretoReasoningLinks } from "../modules/pareto-data.mjs";

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

test("the chart contains only full measured combinations, not model or harness summaries", () => {
  const measured = row("a", "p", "h1", 0.8, 2, "1");
  const unpriced = row("a", "p", "h2", 0.9, null, "2");
  const { points, missingAxis: skipped } = paretoPoints([
    cell("a\tp", "h1", [measured]), cell("a\tp", "h2", [unpriced]),
  ]);
  assert.equal(points.length, 1);
  assert.equal(points[0].kind, "route");
  assert.equal(skipped, 1);
});

test("switching to tokens admits fully tokened runs with no price", () => {
  const noPrice = row("a", "p", "h", 0.8, null, "1");
  noPrice.tokens = { observations: 10, total: 1200 };
  const withoutTokens = row("b", "p", "h", 0.9, null, "2");
  withoutTokens.tokens = { observations: 9, total: 500 };
  const cells = [cell("a\tp", "h", [noPrice]), cell("b\tp", "h", [withoutTokens])];
  assert.deepEqual(paretoPoints(cells, "cost").points, []);
  const { points, missingAxis } = paretoPoints(cells, "tokens");
  assert.equal(points.length, 1);
  assert.equal(points[0].xValue, 1200);
  assert.equal(missingAxis, 1);
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
  assert.equal(point.xValue, 3);
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

test("reasoning variants of one model route and harness version form one dotted sequence", () => {
  const low = { ...row("a", "p", "h", 0.8, 2, "1"), thinking: "low" };
  const high = { ...row("a", "p", "h", 0.9, 4, "2"), thinking: "high" };
  const anotherProvider = { ...row("a", "other", "h", 0.7, 3, "3"), thinking: "high" };
  const points = paretoPoints([
    cell("a\tp", "h", [low, high]), cell("a\tother", "h", [anotherProvider]),
  ]).points;
  assert.equal(points.length, 3);
  assert.deepEqual(points.filter((p) => p.provider === "p").map((p) => p.reasoning).sort(), ["high", "low"]);
  assert.deepEqual(paretoReasoningLinks(points).map((group) => group.map((p) => p.reasoning)), [["low", "high"]]);
  assert.notEqual(points[0].key, points[1].key);
  assert.deepEqual(points.find((p) => p.reasoning === "low").cell.sourceRows, [low]);
});

test("frontier excludes dominated points; equal prices keep the better score", () => {
  const points = [
    { key: "cheap", kind: "route", xValue: 1, score: 0.7 },
    { key: "dominated", kind: "route", xValue: 2, score: 0.6 },
    { key: "better", kind: "route", xValue: 2, score: 0.8 },
    { key: "best", kind: "route", xValue: 4, score: 0.9 },
  ];
  assert.deepEqual(paretoFrontier(points).map((p) => p.key), ["cheap", "better", "best"]);
});
