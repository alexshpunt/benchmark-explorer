import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSnapshot } from "../scripts/build-snapshot.mjs";
import { filterSnapshotRunRows } from "../core.mjs";

const revision = "a".repeat(40);
const views = { schemaVersion: 1, scoring: { id: "explicit-edit-score", version: 2 },
  leaderboard: [], taskFamilies: {} };
const bytes = Buffer.from(JSON.stringify(views));
const digest = createHash("sha256").update(bytes).digest("hex");
const index = { schemaVersion: 1, runs: [], views: { path: "views.json", sha256: digest } };

test("snapshot pins and verifies dataset files before publishing an artifact", async () => {
  globalThis.crypto ??= webcrypto;
  const output = await mkdtemp(join(tmpdir(), "explorer-snapshot-"));
  const requests = [];
  const fetcher = async (url) => {
    const path = String(url);
    requests.push(path);
    if (path.endsWith("dataset-index.json")) return new Response(JSON.stringify(index),
      { headers: { "x-repo-commit": revision } });
    return new Response(bytes);
  };
  try {
    await buildSnapshot({ dataset: "https://example.org/dataset", output, fetcher });
    const manifest = JSON.parse(await readFile(join(output, "snapshot-manifest.json")));
    const compressed = await readFile(join(output, manifest.file));
    assert.equal(manifest.revision, revision);
    assert.equal(createHash("sha256").update(compressed).digest("hex"), manifest.sha256);
    assert.equal(JSON.parse(gunzipSync(compressed)).revision, revision);
    assert.deepEqual(requests, ["https://example.org/dataset/resolve/main/dataset-index.json",
      `https://example.org/dataset/resolve/${revision}/views.json`]);
    await assert.rejects(buildSnapshot({ dataset: "https://example.org/dataset", output,
      fetcher: async (url) => String(url).endsWith("dataset-index.json")
        ? new Response(JSON.stringify({ ...index, views: { ...index.views, sha256: "0".repeat(64) } }),
          { headers: { "x-repo-commit": revision } }) : new Response(bytes) }), /checksum/);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test("snapshot filters pre-aggregated configurations without dropping selected identities", () => {
  const row = { modelFamily: "model", provider: "provider", harnessFamily: "harness",
    harnessVersion: "1", taskFamilies: ["Language edits"], score: 0.8 };
  const snapshot = { runRows: { all: [row], "Language edits": [row] } };
  assert.deepEqual(filterSnapshotRunRows(snapshot, { harness: ["harness"] }), [row]);
  assert.deepEqual(filterSnapshotRunRows(snapshot, { harness: ["other"] }), []);
  assert.deepEqual(filterSnapshotRunRows(snapshot, { taskFamily: ["Language edits"] }), [row]);
});
