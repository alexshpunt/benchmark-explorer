import { createHash, webcrypto } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  aggregateRunConfigurations,
  datasetRevision,
  pinnedDatasetRoot,
  markFullBenchmarkRows,
  median,
  taskFamily,
  validateDatasetSnapshot,
  verifyPublishedBytes,
} from "../core.mjs";

/** Find a batched run's acceptance commit by comparing adjacent pinned Dataset indexes. */
export async function batchedRunDates(runIds, commits, dataset, fetcher = fetch) {
  const missing = new Set(runIds);
  const dates = new Map();
  const indexes = new Map();
  const at = async (commit) => {
    if (!indexes.has(commit.id)) {
      const response = await fetcher(`${dataset}/resolve/${commit.id}/dataset-index.json`);
      if (!response.ok) throw Error(`Dataset index at ${commit.id}: HTTP ${response.status}`);
      const index = await response.json();
      if (!Array.isArray(index.runs)) throw Error(`Invalid Dataset index at ${commit.id}`);
      indexes.set(commit.id, new Set(index.runs.map((run) => run.runId)));
    }
    return indexes.get(commit.id);
  };
  for (let index = 0; index < commits.length - 1 && missing.size; index++) {
    const commit = commits[index];
    if (!/^Accept \d+ verified benchmark execution\(s\)$/.test(commit.title)) continue;
    const current = await at(commit);
    if (![...missing].some((id) => current.has(id))) continue;
    const previous = await at(commits[index + 1]);
    for (const id of missing) if (current.has(id) && !previous.has(id)) {
      dates.set(id, commit.date);
      missing.delete(id);
    }
  }
  return dates;
}

/** Give the three newest accepted runs their commit dates and full-run median scores. */
export function recentRunHighlights(runs, rows, commits, batchedDates = new Map()) {
  const dates = new Map(commits
    .filter((commit) => commit.title?.startsWith("Accept benchmark observation "))
    .map((commit) => [commit.title.slice("Accept benchmark observation ".length), commit.date]));
  return runs.slice(-3).reverse().map(({ runId }) => {
    const acceptedAt = dates.get(runId) ?? batchedDates.get(runId);
    if (!acceptedAt || !Number.isFinite(Date.parse(acceptedAt)))
      throw Error(`Missing Dataset acceptance date for ${runId}`);
    return {
      runId,
      acceptedAt,
      score: median(rows.filter((row) => row.runId === runId && row.fullBenchmark)
        .map((row) => row.score)),
    };
  });
}
/** Build one revision-pinned, checked Explorer artifact from accepted Dataset files. */
export async function buildSnapshot({ dataset = "https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark",
  output = "dist", revision: requestedRevision = null, fetcher = fetch } = {}) {
  const indexResponse = await fetcher(
    `${dataset}/resolve/${requestedRevision ?? "main"}/dataset-index.json`,
  );
  if (!indexResponse.ok) throw Error(`Dataset index: HTTP ${indexResponse.status}`);
  const revision = datasetRevision(indexResponse.headers);
  if (requestedRevision && requestedRevision !== revision)
    throw Error(`Requested Dataset revision ${requestedRevision} resolved to ${revision}`);
  const root = pinnedDatasetRoot(dataset, revision);
  const index = await indexResponse.json();
  const checked = async (file) => {
    const response = await fetcher(new URL(file.path, root));
    if (!response.ok) throw Error(`${file.path}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await verifyPublishedBytes(bytes, file.sha256);
    return bytes;
  };
  if (!index.explorerSummary) throw Error("Dataset does not publish an Explorer summary");
  const summary = JSON.parse(gunzipSync(await checked(index.explorerSummary)).toString("utf8"));
  if (
    summary?.schemaVersion !== 1 ||
    !Array.isArray(summary.profiles) ||
    !Array.isArray(summary.trials) ||
    !Array.isArray(summary.rounds) ||
    !Array.isArray(summary.toolCalls)
  ) {
    throw Error("Unsupported Dataset Explorer summary");
  }
  const views = summary.views;
  validateDatasetSnapshot(index, views);
  const evidence = {
    profiles: summary.profiles,
    trials: summary.trials,
    rounds: summary.rounds,
    toolCalls: summary.toolCalls,
  };
  const families = [...new Set(evidence.trials.map((trial) => taskFamily(trial.taskId)))];
  const runRows = { all: aggregateRunConfigurations(index, evidence.profiles, evidence.trials, evidence.rounds) };
  for (const family of families) runRows[family] = aggregateRunConfigurations(
    index, evidence.profiles, evidence.trials, evidence.rounds, { taskFamily: [family] });
  views.fullRunKeys = markFullBenchmarkRows(runRows, views);
  let recentRuns = [];
  if (index.runs.length) {
    const datasetUrl = new URL(dataset);
    const repository = datasetUrl.pathname.replace(/^\/datasets\//, "").replace(/\/$/, "");
    const commitsUrl = `${datasetUrl.origin}/api/datasets/${repository}/commits/${revision}?limit=1000`;
    const commitsResponse = await fetcher(commitsUrl);
    if (!commitsResponse.ok) throw Error(`Dataset commit history: HTTP ${commitsResponse.status}`);
    const commits = await commitsResponse.json();
    if (!Array.isArray(commits)) throw Error("Invalid Dataset commit history");
    const recentIds = index.runs.slice(-3).map((run) => run.runId);
    const explicit = new Set(commits.filter((commit) => commit.title?.startsWith("Accept benchmark observation "))
      .map((commit) => commit.title.slice("Accept benchmark observation ".length)));
    const missing = recentIds.filter((id) => !explicit.has(id));
    const batched = missing.length ? await batchedRunDates(missing, commits, dataset, fetcher) : new Map();
    recentRuns = recentRunHighlights(index.runs, runRows.all, commits, batched);
  }
  const snapshot = { schemaVersion: 1, revision, index, views, runRows, recentRuns, ...evidence };
  const bytes = gzipSync(JSON.stringify(snapshot), { level: 9, mtime: 0 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = `snapshots/snapshot.${sha256}.json.gz`;
  await mkdir(resolve(output, "snapshots"), { recursive: true });
  await writeFile(resolve(output, file), bytes);
  await writeFile(resolve(output, "snapshot-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    revision,
    file,
    sha256,
    bytes: bytes.length,
    trials: evidence.trials.length,
  }) + "\n");
  return { revision, trials: evidence.trials.length, bytes: bytes.length };
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  globalThis.crypto ??= webcrypto;
  buildSnapshot({
    output: process.argv[2] ?? "dist",
    revision: process.env.DATASET_REVISION || null,
  }).then(console.log).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
