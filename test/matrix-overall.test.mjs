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

test("expanded model rows do not count again in the harness Overall", () => {
  const cells = [cell("a", 0.3), cell("a\tp1", 0.1), cell("a\tp2", 0.5), cell("b", 0.9)];
  assert.equal(matrixAcrossModels(cells, { columnKey: "h", harness: "h", label: "h" }).score, 0.6);
});
