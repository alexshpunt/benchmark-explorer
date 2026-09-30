import assert from "node:assert/strict";
import test from "node:test";
import { communityOverview, typicalRange } from "../modules/community.mjs";

const row = (modelFamily, runId, cost = 1, duration = 600) => ({
  modelFamily, provider: "p", runId, harnessFamily: "h", harnessVersion: "1", thinking: "low",
  fullBenchmark: true, score: 0.9, observations: 10,
  cost: { observations: 10, total: cost }, duration: { observations: 10, total: duration },
});

test("header card links show one relevant panel without rebuilding contributor evidence", async () => {
  const { installCommunityCards } = await import("../modules/community.mjs");
  const handlers = new Map();
  const keys = ["participate", "contributors", "cost", "time", "method", "news"];
  const panels = ["participate", "contributors", "measurements", "method", "news"]
    .map((key) => ({ dataset: { communityPanel: key }, hidden: true }));
  const title = { textContent: "" };
  const dialog = { open: false, scrollTop: 99, showModal() { this.open = true; }, close() { this.open = false; } };
  const previous = globalThis.document;
  globalThis.document = {
    querySelector: (selector) => selector === "#community-dialog" ? dialog :
      selector === "#community-card-title" ? title : { addEventListener: (_event, fn) => handlers.set("close", fn) },
    querySelectorAll: (selector) => selector === "[data-community-panel]" ? panels :
      keys.map((key) => ({ dataset: { communityCard: key }, addEventListener: (_event, fn) => handlers.set(key, fn) })),
  };
  try {
    installCommunityCards();
    for (const key of keys) {
      handlers.get(key)();
      assert.equal(dialog.open, true);
      assert.equal(dialog.scrollTop, 0);
      const expected = ["cost", "time"].includes(key) ? "measurements" : key;
      assert.deepEqual(panels.filter((panel) => !panel.hidden).map((panel) => panel.dataset.communityPanel), [expected]);
      handlers.get("close")();
      assert.equal(dialog.open, false);
    }
  } finally { globalThis.document = previous; }
});
test("time estimate uses concurrency ten and keeps the measured sum and caveat", async () => {
  const { renderCommunity } = await import("../modules/community.mjs");
  const nodes = new Map();
  const previous = globalThis.document;
  globalThis.document = { querySelector: (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: "", replaceChildren() {} });
    return nodes.get(selector);
  } };
  try {
    renderCommunity({ index: { runs: [] }, runRows: { all: [row("r", "m", 1, 5880)] } }, () => {});
    assert.match(nodes.get("#community-time").textContent, /≈10 min typical/);
    assert.match(nodes.get("#community-summed-time").textContent, /98 min median/);
    assert.match(nodes.get("#community-samples").textContent, /concurrency 10/);
    assert.match(nodes.get("#community-samples").textContent, /not measured elapsed time/);
    assert.match(nodes.get("#community-cost").textContent, /\$1.00 typical/);
  } finally { globalThis.document = previous; }
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
