import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acceptedRunHighlights, buildSnapshot, recentRunHighlights } from "../scripts/build-snapshot.mjs";
import {
  aggregateLeaderboard,
  compactToolCalls,
  expandToolCounts,
  filterSnapshotRunRows,
  setViewsData,
} from "../core.mjs";

const revision = "a".repeat(40);
const views = { schemaVersion: 1, scoring: { id: "explicit-edit-score", version: 2 },
  leaderboard: [], taskFamilies: {} };
const summary = {
  schemaVersion: 2,
  views,
  profiles: [],
  trials: [],
  rounds: [],
  toolCounts: [{ runId: "run", roundId: "round", tool: "read", calls: 2 }],
};
const bytes = Buffer.from(JSON.stringify(summary));
const compressedSummary = gzipSync(bytes, { level: 6, mtime: 0 });
const digest = createHash("sha256").update(compressedSummary).digest("hex");
const index = {
  schemaVersion: 1,
  runs: [],
  views: { path: "views.json", sha256: "b".repeat(64) },
  explorerSummary: { path: "data/explorer-summary.json.gz", sha256: digest },
};

test("snapshot pins and verifies dataset files before publishing an artifact", async () => {
  globalThis.crypto ??= webcrypto;
  const output = await mkdtemp(join(tmpdir(), "explorer-snapshot-"));
  const requests = [];
  const fetcher = async (url) => {
    const path = String(url);
    requests.push(path);
    if (path.endsWith("dataset-index.json")) return new Response(JSON.stringify(index),
      { headers: { "x-repo-commit": revision } });
    return new Response(compressedSummary);
  };
  try {
    await buildSnapshot({ dataset: "https://example.org/dataset", output, fetcher });
    const manifest = JSON.parse(await readFile(join(output, "snapshot-manifest.json")));
    const compressed = await readFile(join(output, manifest.file));
    assert.equal(manifest.revision, revision);
    assert.match(manifest.file, /^snapshots\/snapshot\.[a-f0-9]{64}\.json\.gz$/);
    assert.equal(manifest.file, `snapshots/snapshot.${manifest.sha256}.json.gz`);
    assert.equal(createHash("sha256").update(compressed).digest("hex"), manifest.sha256);
    const snapshot = JSON.parse(gunzipSync(compressed));
    assert.equal(snapshot.revision, revision);
    assert.deepEqual(snapshot.toolCounts, summary.toolCounts);
    assert.equal(snapshot.toolCalls, undefined);
    assert.deepEqual(requests, ["https://example.org/dataset/resolve/main/dataset-index.json",
      `https://example.org/dataset/resolve/${revision}/data/explorer-summary.json.gz`]);
    await assert.rejects(buildSnapshot({ dataset: "https://example.org/dataset", output,
      fetcher: async (url) => String(url).endsWith("dataset-index.json")
        ? new Response(JSON.stringify({
          ...index,
          explorerSummary: { ...index.explorerSummary, sha256: "0".repeat(64) },
        }), { headers: { "x-repo-commit": revision } })
        : new Response(compressedSummary) }), /checksum/);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test("compact tool counts preserve normalized tool events", () => {
  const calls = [
    { runId: "run", roundId: "round", tool: "read" },
    { runId: "run", roundId: "round", tool: "read" },
  ];
  assert.deepEqual(compactToolCalls(calls), [
    { runId: "run", roundId: "round", tool: "read", calls: 2 },
  ]);
  assert.deepEqual(
    expandToolCounts([{ runId: "run", roundId: "round", tool: "read", calls: 2 }]),
    [
      { runId: "run", roundId: "round", tool: "read" },
      { runId: "run", roundId: "round", tool: "read" },
    ],
  );
  assert.throws(
    () => expandToolCounts([{ runId: "run", roundId: "round", tool: "read", calls: -1 }]),
    /Invalid compact tool count/,
  );
});

test("all accepted runs are sorted newest first with their full-run score", () => {
  const runs = [{ runId: "older" }, { runId: "newer" }];
  const rows = [
    { runId: "older", score: 0.7, fullBenchmark: true },
    { runId: "newer", score: 0.9, fullBenchmark: true },
  ];
  const commits = [
    { title: "Accept benchmark observation newer", date: "2026-09-28T12:00:00.000Z" },
    { title: "Accept benchmark observation older", date: "2026-09-27T12:00:00.000Z" },
  ];
  assert.deepEqual(acceptedRunHighlights(runs, rows, commits), [
    { runId: "newer", acceptedAt: commits[0].date, score: 0.9 },
    { runId: "older", acceptedAt: commits[1].date, score: 0.7 },
  ]);
});

test("recent runs use their dataset acceptance date and median of full scores", () => {
  const runs = ["older", "multi", "partial", "newest"].map((runId) => ({ runId }));
  const rows = [
    { runId: "multi", score: 0.8, fullBenchmark: true },
    { runId: "multi", score: 1, fullBenchmark: true },
    { runId: "multi", score: 0.1, fullBenchmark: false },
    { runId: "partial", score: 0.2, fullBenchmark: false },
    { runId: "newest", score: 0.95, fullBenchmark: true },
  ];
  const commits = [
    { title: "Accept benchmark observation newest", date: "2026-09-27T12:00:00.000Z" },
    { title: "Accept benchmark observation partial", date: "2026-09-26T12:00:00.000Z" },
    { title: "Accept benchmark observation multi", date: "2026-09-25T12:00:00.000Z" },
  ];
  assert.deepEqual(recentRunHighlights(runs, rows, commits), [
    { runId: "newest", acceptedAt: commits[0].date, score: 0.95 },
    { runId: "partial", acceptedAt: commits[1].date, score: null },
    { runId: "multi", acceptedAt: commits[2].date, score: 0.9 },
  ]);
  assert.throws(() => recentRunHighlights(runs, rows, commits.slice(0, 2)), /acceptance date/);
});

test("batched acceptance dates come from the commit that first contains a run", async () => {
  const { batchedRunDates } = await import("../scripts/build-snapshot.mjs");
  const commits = [
    { id: "new", title: "Accept 1 verified benchmark execution(s)", date: "2026-09-28T13:48:26Z" },
    { id: "old", title: "Accept 1 verified benchmark execution(s)", date: "2026-09-28T13:27:45Z" },
    { id: "before", title: "Other change", date: "2026-09-28T13:00:00Z" },
  ];
  const indexes = { new: ["first", "second"], old: ["first"], before: [] };
  const fetcher = async (url) => {
    const commit = String(url).split("/").at(-2);
    return new Response(JSON.stringify({ runs: indexes[commit].map((runId) => ({ runId })) }));
  };
  const dates = await batchedRunDates(["first", "second"], commits,
    "https://example.org/dataset", fetcher);
  assert.equal(dates.get("first"), commits[1].date);
  assert.equal(dates.get("second"), commits[0].date);
});

test("multiple task families recompute leaderboard scores from the selected tasks", () => {
  const row = {
    modelFamily: "model", provider: "provider", harnessFamily: "harness",
    runIds: ["run"], configurationHashes: ["configuration"], rankingEligible: true,
    configurationTaskCells: [
      { taskId: "language-a", observations: 1, firstExactRate: 1, finalExactRate: 1 },
      { taskId: "unicode-fix-a", observations: 1, firstExactRate: 0, finalExactRate: 0 },
      { taskId: "replace-block-a", observations: 1, firstExactRate: 0, finalExactRate: 0 },
    ],
    firstExactRate: 1 / 3, finalExactRate: 1 / 3, qualityScore: 1 / 3,
    coverage: 1, score: 1 / 3,
  };
  setViewsData({ schemaVersion: 1, leaderboard: [row], taskFamilies: {}, fullRunKeys: [] });
  const [selected] = aggregateLeaderboard(null, null, null, null, {
    taskFamily: ["Language edits", "Unicode fixes"],
  });
  assert.equal(selected.firstExactRate, 0.5);
  assert.equal(selected.finalExactRate, 0.5);
  assert.equal(selected.score, 0.5);
  assert.deepEqual(selected.taskFamilies, ["Language edits", "Unicode fixes"]);
});

test("snapshot filters pre-aggregated configurations without dropping selected identities", () => {
  const row = { modelFamily: "model", provider: "provider", harnessFamily: "harness",
    harnessVersion: "1", taskFamilies: ["Language edits"], score: 0.8 };
  const snapshot = { runRows: { all: [row], "Language edits": [row] } };
  assert.deepEqual(filterSnapshotRunRows(snapshot, { harness: ["harness"] }), [row]);
  assert.deepEqual(filterSnapshotRunRows(snapshot, { harness: ["other"] }), []);
  assert.deepEqual(filterSnapshotRunRows(snapshot, { taskFamily: ["Language edits"] }), [row]);
});
