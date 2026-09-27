import assert from "node:assert/strict";
import test from "node:test";
import { matrixAcrossModels } from "../modules/matrix.mjs";

const cell = (model, score) => ({ model, columnKey: "h", harness: "h", label: "h", score,
  observations: 226, sourceRows: [{ modelFamily: model.split("\t")[0] }] });

test("harness Overall gives each model one vote even with multiple providers", () => {
  const cells = [cell("a\tp1", 0.1), cell("a\tp2", 0.3), cell("a\tp3", 0.5), cell("b\tp1", 0.9)];
  const result = matrixAcrossModels(cells, { columnKey: "h", harness: "h", label: "h" });
  assert.equal(result.score, 0.6); // median of model a (0.3) and model b (0.9)
  assert.equal(result.model, "Overall");
  assert.equal(result.sourceRows.length, 4);
});

test("matched harness score compares common model families and ignores unpaired outliers", async () => {
  const { matrixMatchedHarnessDelta } = await import("../modules/matrix.mjs");
  const rows = [
    cell("a\tp1", 0.7), cell("a\tp2", 0.9), cell("b\tp1", 0.8), cell("c\tp1", 0.6),
  ].map((item) => ({ ...item, harness: "pi-default", columnKey: "pi-default" }));
  rows.push(...[
    cell("a\tp1", 0.9), cell("a\tp2", 0.9), cell("b\tp1", 0.7), cell("c\tp1", 0.7),
    cell("unpaired\tp1", 0.01),
  ].map((item) => ({ ...item, harness: "other", columnKey: "other" })));
  const result = matrixMatchedHarnessDelta(rows, { columnKey: "other" });
  assert.equal(result.pairs, 3);
  assert.ok(Math.abs(result.delta - 0.1) < 1e-10); // a: +0.1, b: -0.1, c: +0.1
  assert.equal(result.modelFamilies.length, 3);
});

test("expanded providers do not give a model extra votes in paired scores", async () => {
  const { matrixMatchedHarnessDelta } = await import("../modules/matrix.mjs");
  const rows = [
    ...[cell("a", 0.5), cell("a\tp1", 0.1), cell("a\tp2", 0.9), cell("b", 0.5), cell("c", 0.5)]
      .map((item) => ({ ...item, harness: "pi-default", columnKey: "pi-default" })),
    ...[cell("a", 0.6), cell("a\tp1", 1), cell("a\tp2", 0.2), cell("b", 0.6), cell("c", 0.6)]
      .map((item) => ({ ...item, harness: "other", columnKey: "other" })),
  ];
  const result = matrixMatchedHarnessDelta(rows, { columnKey: "other" });
  assert.equal(result.pairs, 3);
  assert.ok(Math.abs(result.delta - 0.1) < 1e-10);
});

test("fewer than three shared full model families have no comparable score", async () => {
  const { matrixMatchedHarnessDelta } = await import("../modules/matrix.mjs");
  const rows = [cell("a\tp", 0.9), cell("b\tp", 0.8)].map((item) =>
    ({ ...item, harness: "pi-default", columnKey: "pi-default" }));
  rows.push(...[cell("a\tp", 0.99), cell("b\tp", 0.99), cell("c\tp", 0.99)].map((item) =>
    ({ ...item, harness: "other", columnKey: "other" })));
  assert.deepEqual(matrixMatchedHarnessDelta(rows, { columnKey: "other" }).delta, null);
  assert.equal(matrixMatchedHarnessDelta(rows, { columnKey: "other" }).pairs, 2);
});

test("expanded model rows do not count again in the harness Overall", () => {
  const cells = [cell("a", 0.3), cell("a\tp1", 0.1), cell("a\tp2", 0.5), cell("b", 0.9)];
  assert.equal(matrixAcrossModels(cells, { columnKey: "h", harness: "h", label: "h" }).score, 0.6);
});
