import { createHash, webcrypto } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  aggregateRunConfigurations,
  datasetRevision,
  parseJsonLines,
  pinnedDatasetRoot,
  markFullBenchmarkRows,
  taskFamily,
  validateDatasetSnapshot,
  verifyPublishedBytes,
} from "../core.mjs";

/** Build one revision-pinned, checked Explorer artifact from accepted Dataset files. */
export async function buildSnapshot({ dataset = "https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark",
  output = "dist", fetcher = fetch } = {}) {
  const indexResponse = await fetcher(`${dataset}/resolve/main/dataset-index.json`);
  if (!indexResponse.ok) throw Error(`Dataset index: HTTP ${indexResponse.status}`);
  const revision = datasetRevision(indexResponse.headers);
  const root = pinnedDatasetRoot(dataset, revision);
  const index = await indexResponse.json();
  const checked = async (file) => {
    const response = await fetcher(new URL(file.path, root));
    if (!response.ok) throw Error(`${file.path}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await verifyPublishedBytes(bytes, file.sha256);
    return bytes;
  };
  const views = JSON.parse(new TextDecoder().decode(await checked(index.views)));
  validateDatasetSnapshot(index, views);
  const evidence = { profiles: [], trials: [], rounds: [], toolCalls: [] };
  const fields = {
    profiles: ["runId", "profileId", "agentFamily", "agentVersion", "harnessFamily", "harnessId", "harnessVersion", "modelFamily", "modelId", "model", "modelVersion", "provider", "configurationHash", "transport", "harnessKind", "adapterVersion", "configurationLabels", "thinking"],
    trials: ["runId", "trialId", "profileId", "taskId", "rounds", "firstExactPassed", "finalExactPassed"],
    rounds: ["runId", "roundId", "trialId", "seconds", "costUsd", "totalTokens"],
    toolCalls: ["runId", "roundId", "tool"],
  };
  for (let position = 0; position < index.runs.length; position += 5) {
    console.log(`Building snapshot: ${position}/${index.runs.length} runs`);
    const batch = await Promise.all(index.runs.slice(position, position + 5).map(async (run) =>
      Promise.all([["profiles", "profiles"], ["trials", "trials"],
        ["rounds", "rounds"], ["tool-calls", "toolCalls"]].map(async ([table, key]) => {
        const bytes = await checked(run.files[table]);
        return [key, parseJsonLines(gunzipSync(bytes).toString("utf8"))];
      }))));
    for (const run of batch) for (const [key, rows] of run) {
      evidence[key].push(...rows.map((row) => Object.fromEntries(
        fields[key].filter((field) => row[field] !== undefined).map((field) => [field, row[field]]))));
    }
  }
  const families = [...new Set(evidence.trials.map((trial) => taskFamily(trial.taskId)))];
  const runRows = { all: aggregateRunConfigurations(index, evidence.profiles, evidence.trials, evidence.rounds) };
  for (const family of families) runRows[family] = aggregateRunConfigurations(
    index, evidence.profiles, evidence.trials, evidence.rounds, { taskFamily: [family] });
  views.fullRunKeys = markFullBenchmarkRows(runRows, views);
  const snapshot = { schemaVersion: 1, revision, index, views, runRows, ...evidence };
  const bytes = gzipSync(JSON.stringify(snapshot), { level: 9 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(resolve(output), { recursive: true });
  await writeFile(resolve(output, "snapshot.json.gz"), bytes);
  await writeFile(resolve(output, "snapshot-manifest.json"), JSON.stringify({ schemaVersion: 1, revision,
    file: "snapshot.json.gz", sha256, trials: evidence.trials.length }) + "\n");
  return { revision, trials: evidence.trials.length, bytes: bytes.length };
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  globalThis.crypto ??= webcrypto;
  buildSnapshot({ output: process.argv[2] ?? "dist" }).then(console.log).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
