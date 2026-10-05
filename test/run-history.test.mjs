import test from "node:test";
import assert from "node:assert/strict";
import { configurationHistory, publicationDateText } from "../modules/run-history.mjs";

const row = (runId, changes = {}) => ({ runId, runIds: [runId], modelFamily: "m", provider: "p", thinking: "high",
  harnessFamily: "h", harnessVersion: "2", agentFamily: "pi", fullBenchmark: true, score: 0.8, ...changes });
const old = row("old", { harnessVersion: "1", score: 0 });
const current = row("new");
const repeat = row("repeat");
const noDate = row("undated");
const all = [old, current, repeat, noDate, row("partial", { fullBenchmark: false }),
  row("invalid", { score: NaN }), row("other-mode", { thinking: "low" }), row("other-provider", { provider: "q" }),
  row("other-harness", { harnessFamily: "g" })];
const snapshot = { runRows: { all }, acceptedRuns: all.filter(r => r !== noDate).map(r => ({ runId: r.runId,
  acceptedAt: r === old ? "2026-09-01T00:00:00Z" : "2026-10-01T00:00:00Z" })) };

test("history restores older versions and repeats without joining other routes or changing rows", () => {
  const before = structuredClone(all);
  const history = configurationHistory([current], snapshot);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].points.map(p => [p.row.runId, p.score]), [["old", 0], ["new", 80], ["repeat", 80]]);
  assert.deepEqual(history[0].rows.map(r => r.runId), ["old", "new", "repeat", "undated", "partial", "invalid"]);
  assert.equal(history[0].undated, 1);
  assert.deepEqual(all, before);
});

test("history isolates each harness and exact route and can stay scoped to one run", () => {
  assert.equal(configurationHistory([current, all.at(-1)], snapshot).length, 2);
  const history = configurationHistory([current], snapshot, { runId: "new" });
  assert.deepEqual(history[0].points.map(p => p.row.runId), ["new"]);
  assert.equal(configurationHistory([], snapshot).length, 0);
});

test("publication labels are UTC, truthful for missing dates, and show the date span of repeats", () => {
  assert.equal(publicationDateText(["old", "new"], snapshot), "Sep 1, 2026 – Oct 1, 2026");
  assert.equal(publicationDateText(["undated"], snapshot), "Unavailable");
  assert.equal(publicationDateText(["old", "undated"], snapshot), "Sep 1, 2026 · 1 unavailable");
});
