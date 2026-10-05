/** Median of reported values; each provider route can contribute one value. */
export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null;
}

/** One median per provider route, then the median of those route values. */
export function providerMedian(cells, field) {
  const routes = new Map();
  for (const cell of cells)
    routes.set(cell.model, [...(routes.get(cell.model) ?? []), cell[field]]);
  return median([...routes.values()].map(median));
}
/** Count full model-route results per accepted run and harness, including batched runs. */
export function matrixHarnessRunCounts(rows) {
  const runs = new Map();
  for (const row of rows) {
    if (row.fullBenchmark !== true || !Number.isFinite(row.score)) continue;
    const ids = runs.get(row.harnessFamily) ?? new Set();
    ids.add(JSON.stringify([row.runId, modelRouteIdentity(row)]));
    runs.set(row.harnessFamily, ids);
  }
  return new Map([...runs].map(([harness, ids]) => [harness, ids.size]));
}

/** Keep established harnesses separate and collapse rare ones into expandable groups. */
export function matrixHarnessGroup(harness, counts) {
  if (["pi-extensions", "Others"].includes(harness)) return harness;
  if ((counts.get(harness) ?? 0) > 3) return harness;
  if (/pi-(?:extensions|hashline-edit)/i.test(harness) ||
      (harness.startsWith("pi-") && !["pi-default", "pi-agent-ide"].includes(harness)))
    return "pi-extensions";
  return "Others";
}

/** Split accepted runs into bounded batches, using the newest runs in preview mode. */
export function runBatches(runs, limit = null, size = 5) {
  const chosen = limit == null ? runs : runs.slice(-limit);
  const batches = [];
  for (let index = 0; index < chosen.length; index += size)
    batches.push(chosen.slice(index, index + size));
  return batches;
}

const metricNames = ["duration", "cost", "tokens"];
/** Per-trial sample fields for each observed metric. */
const SAMPLE_FIELDS = { duration: "seconds", cost: "costUsd", tokens: "tokens" };
const reasoningOrder = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
let precomputedViews = null;
const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

/** Return the immutable Dataset commit exposed by the Hugging Face resolver. */
export function datasetRevision(headers) {
  const revision = headers.get("x-repo-commit");
  if (!revision || !COMMIT.test(revision)) throw Error("Dataset response has no valid commit header");
  return revision;
}

/** Build the only root used after resolving the current Dataset commit. */
export function pinnedDatasetRoot(datasetPage, revision) {
  if (!COMMIT.test(revision)) throw Error("Invalid Dataset commit");
  return datasetPage.replace(/\/$/u, "") + "/resolve/" + revision + "/";
}

/** Reject views whose public contract is newer or different from this Explorer. */
export function validateDatasetSnapshot(index, views) {
  if (index?.schemaVersion !== 1 || !Array.isArray(index.runs))
    throw Error("Unsupported Dataset index schema");
  if (views?.schemaVersion !== 1 || !Array.isArray(views.leaderboard))
    throw Error("Unsupported Dataset views schema");
  if (views.scoring?.id !== "explicit-edit-score" || ![1, 2].includes(views.scoring?.version))
    throw Error("Unsupported scoring version");
  if (views.exclusions) {
    if (
      !/^benchmark-exclusions-v[1-9][0-9]*$/u.test(views.exclusions.policyId) ||
      !SHA256.test(views.exclusions.policyRevision)
    )
      throw Error("Unsupported exclusion policy");
  }
  return true;
}

/** Verify exact published bytes before parsing or decompressing them. */
export async function verifyPublishedBytes(bytes, expectedSha256) {
  if (!SHA256.test(expectedSha256)) throw Error("Missing published checksum");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== expectedSha256) throw Error("Downloaded file did not match its published checksum");
  return true;
}

/** Resolve the dynamic latest alias to the highest accepted semantic version. */
export function resolveHarnessVersion(configurations, harness, requestedVersion) {
  if (requestedVersion !== "latest") return requestedVersion;
  const versions = configurations
    .filter((row) => row.harnessFamily === harness && row.harnessVersion)
    .map((row) => row.harnessVersion);
  return versions.sort(compareHarnessVersions).at(-1) ?? null;
}

/**
 * Pick each exact route’s newest complete harness version, then its last accepted run.
 * Partial-only routes retain their newest evidence. Run order comes from the pinned
 * Dataset index; exact configurations from the selected run remain available.
 */
export function latestHarnessConfigurations(rows, acceptedRunIds) {
  const runOrder = new Map(acceptedRunIds.map((runId, index) => [runId, index]));
  const latest = new Map();
  const pairKey = (row) => JSON.stringify([modelRouteIdentity(row), row.harnessFamily]);
  const completePairs = new Set(rows.filter((row) => row.fullBenchmark && Number.isFinite(row.score)).map(pairKey));
  for (const row of rows) {
    const key = pairKey(row);
    if (completePairs.has(key) && (!row.fullBenchmark || !Number.isFinite(row.score))) continue;
    const current = latest.get(key);
    const versionOrder = current
      ? compareHarnessVersions(row.harnessVersion ?? "", current.version ?? "")
      : 1;
    const rowRun = runOrder.get(row.runId) ?? -1;
    const currentRun = current ? (runOrder.get(current.runId) ?? -1) : -1;
    if (!current || versionOrder > 0 || (versionOrder === 0 && rowRun > currentRun)) {
      latest.set(key, { version: row.harnessVersion, runId: row.runId });
    }
  }
  return rows.filter((row) => {
    const key = pairKey(row);
    if (completePairs.has(key) && (!row.fullBenchmark || !Number.isFinite(row.score))) return false;
    const selected = latest.get(key);
    return selected?.version === row.harnessVersion && selected.runId === row.runId;
  });
}

/** Compare semantic harness versions, with a numeric fallback for non-semver labels. */
export function compareHarnessVersions(left, right) {
  const parse = (version) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null] : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return left.localeCompare(right, undefined, { numeric: true });
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  if (a[3] === b[3]) return 0;
  if (a[3] === null) return 1;
  if (b[3] === null) return -1;
  return a[3].localeCompare(b[3], undefined, { numeric: true });
}

/** Install trusted views produced during Dataset acceptance. */
export function setViewsData(data) {
  if (data?.schemaVersion !== 1 || !data?.leaderboard) {
    throw Error("Unsupported precomputed views");
  }
  precomputedViews = data;
}

/** Collapse normalized tool events for transfer without changing their counts. */
export function compactToolCalls(toolCalls) {
  const counts = new Map();
  for (const call of toolCalls) {
    if (!call.runId || !call.roundId || !call.tool) continue;
    const key = JSON.stringify([call.runId, call.roundId, call.tool]);
    const current = counts.get(key) ?? {
      runId: call.runId,
      roundId: call.roundId,
      tool: call.tool,
      calls: 0,
    };
    current.calls += 1;
    counts.set(key, current);
  }
  return [...counts.values()];
}

/** Expand compact tool counters into the normalized events used by interactive calculations. */
export function expandToolCounts(toolCounts) {
  return toolCounts.flatMap((entry) => {
    if (
      typeof entry.runId !== "string" ||
      typeof entry.roundId !== "string" ||
      typeof entry.tool !== "string" ||
      !Number.isSafeInteger(entry.calls) ||
      entry.calls < 0
    ) {
      throw Error("Invalid compact tool count");
    }
    return Array.from({ length: entry.calls }, () => ({
      runId: entry.runId,
      roundId: entry.roundId,
      tool: entry.tool,
    }));
  });
}

/** Parse newline-delimited JSON, ignoring blank lines. */
export function parseJsonLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Return one stable model identity whether its provider prefix was recorded or omitted. */
export function canonicalModelFamily(value) {
  return String(value).split("/").at(-1);
}

/** Keep missing reasoning explicit; it is not the same configuration as off. */
export function modelReasoning(row) {
  return row.thinking == null || row.thinking === "" ? "unspecified" : String(row.thinking);
}

/** Rated model identity: model family and its recorded reasoning mode, without provider. */
export function modelIdentity(row) {
  return `${canonicalModelFamily(row.modelFamily)}\t${modelReasoning(row)}`;
}

/** Format model names; include the provider for exact routes, omit it for ratings. */
export function modelLabel(row, { includeProvider = false } = {}) {
  const model = canonicalModelFamily(row.modelFamily ?? row.modelId ?? "Model");
  const prefix = includeProvider ? `${row.provider ?? "unknown"} / ` : "";
  return `${prefix}${model} · ${modelReasoning(row)}`;
}

/** Exact comparison route: model family, provider, and recorded reasoning mode. */
export function modelRouteIdentity(row) {
  return `${canonicalModelFamily(row.modelFamily)}\t${row.provider ?? "unknown"}\t${modelReasoning(row)}`;
}

/** Model route label shown in the matrix and drill-downs. */
export function modelRouteLabel(row) {
  return modelLabel(row, { includeProvider: true });
}

/** Format a serialized exact route, or keep a collapsed family-only group label. */
export function modelRouteLabelFromIdentity(identity) {
  const [modelFamily, provider, thinking] = identity.split("\t");
  return provider ? modelRouteLabel({ modelFamily, provider, thinking }) : modelFamily;
}

/** Position a floating filter menu inside the viewport next to its trigger. */
export function popoverPosition(trigger, viewport, menu, gap = 4) {
  const left = Math.max(12, Math.min(trigger.left, viewport.width - menu.width - 12));
  const below = trigger.bottom + gap;
  const top =
    below + menu.height <= viewport.height - 12
      ? below
      : Math.max(12, trigger.top - menu.height - gap);
  return { left, top };
}

/** Return a stable, human-readable family for a benchmark task id. */
export function taskFamily(taskId) {
  if (taskId.startsWith("language-")) return "Language edits";
  if (taskId.startsWith("unicode-fix-")) return "Unicode fixes";
  if (taskId.startsWith("literal-")) return "Literal edge cases";
  if (/^(replace|delete|move|copy|insert)-block-/u.test(taskId)) return "Block edits";
  if (/^(copy-within|move-between|insert-payload)-/u.test(taskId)) return "Cross-file edits";
  if (/^(select|delete|insert)-subset-/u.test(taskId)) return "Subset edits";
  if (taskId.startsWith("replace-all-")) return "Replace all";
  if (taskId.startsWith("select-one-")) return "Select one";
  if (taskId.startsWith("multi-file-")) return "Multi-file edits";
  if (taskId.startsWith("distinct-edits-")) return "Distinct edits";
  if (taskId.startsWith("unique-")) return "Unique match";
  return "Other";
}
const explorerKeys = ["model", "reasoning", "agent", "harness", "benchmark", "config", "run"];
const matrixMetricIds = new Set([
  "score",
  "firstExact",
  "avgCost",
  "avgTokens",
  "qualityPerDollar",
]);
const explorerFilterKeys = [
  "provider",
  "model",
  "reasoning",
  "agent",
  "agentVersion",
  "harness",
  "harnessVersion",
  "benchmark",
  "benchmarkVersion",
  "taskFamily",
  "runner",
];

/** Parse the shareable entity selection from a URL query string. */
export function parseExplorerState(search) {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    explorerKeys.flatMap((key) => {
      const value = params.get(key)?.trim();
      return value ? [[key, value]] : [];
    }),
  );
}

/** Parse shareable filters, sorting, and comparison state from a URL query string. */
export function parseExplorerControls(search) {
  const params = new URLSearchParams(search);
  const filters = Object.fromEntries(
    explorerFilterKeys.flatMap((key) => {
      const values = params
        .getAll(`filter.${key}`)
        .map((value) => value.trim())
        .filter(Boolean);
      return values.length ? [[key, values]] : [];
    }),
  );
  const groupBy = params
    .getAll("group")
    .map((value) => value.trim())
    .filter((value) => ["model", "agent", "harness", "config"].includes(value));
  return {
    comparison: params.get("comparison")?.trim() || "all",
    groupBy: groupBy.length ? groupBy : ["model"],
    reference: params.get("reference")?.trim() || null,
    sortBy: params.get("sort")?.trim() || "score",
    sortDirection: params.get("direction") === "asc" ? "asc" : "desc",
    matrixMetric: matrixMetricIds.has(params.get("metric")) ? params.get("metric") : "score",
    expandedHarnesses: params
      .getAll("expandHarness")
      .map((value) => value.trim())
      .filter(Boolean),
    filters,
  };
}

/**
 * Build a stable query string for a shareable explorer state.
 * @param {Record<string, string | undefined>} selection
 * @param {{comparison?: string, groupBy?: string[], reference?: string | null, sortBy?: string, sortDirection?: string, matrixMetric?: string, expandedHarnesses?: string[], filters?: Record<string, string[]>} | null} [controls]
 */
export function explorerSearch(selection, controls = null) {
  const params = new URLSearchParams();
  for (const key of explorerKeys) {
    if (selection[key]) params.set(key, selection[key]);
  }
  if (controls) {
    if (controls.comparison && controls.comparison !== "all")
      params.set("comparison", controls.comparison);
    if (controls.groupBy && !(controls.groupBy.length === 1 && controls.groupBy[0] === "model")) {
      for (const dimension of controls.groupBy) params.append("group", dimension);
    }
    if (controls.reference) params.set("reference", controls.reference);
    if (controls.matrixMetric) params.set("metric", controls.matrixMetric);
    for (const harness of [...new Set(controls.expandedHarnesses ?? [])].sort()) {
      params.append("expandHarness", harness);
    }
    if (controls.sortBy && controls.sortBy !== "score") params.set("sort", controls.sortBy);
    if (controls.sortDirection && controls.sortDirection !== "desc")
      params.set("direction", controls.sortDirection);
    for (const key of explorerFilterKeys) {
      for (const value of controls.filters?.[key] ?? []) params.append(`filter.${key}`, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function exactIdentity(profile, run) {
  const benchmark = run.definitions?.benchmark;
  const agentHarness = {
    agentFamily: profile.agentFamily ?? null,
    agentVersion: profile.agentVersion ?? null,
    harnessFamily: profile.harnessFamily ?? profile.harnessId ?? null,
    harnessVersion: profile.harnessVersion ?? null,
  };
  return {
    benchmarkId: benchmark?.id ?? run.contract,
    benchmarkVersion: benchmark?.version ?? null,
    contract: run.contract,
    runnerFamily: run.definitions?.runner?.id ?? null,
    runnerVersion: run.definitions?.runner?.version ?? null,
    modelFamily: profile.modelFamily ?? profile.modelId ?? profile.model,
    modelVersion: profile.modelVersion ?? profile.model ?? null,
    ...agentHarness,
    provider: profile.provider ?? null,
    configurationHash: profile.configurationHash ?? `${profile.runId}/${profile.profileId}`,
    transport: profile.transport ?? null,
    harnessKind: profile.harnessKind ?? null,
    adapterVersion: profile.adapterVersion ?? null,
    configurationLabels: profile.configurationLabels ?? [],
    thinking: profile.thinking ?? null,
  };
}

function matchesModelFilter(value, selected) {
  if (!selected || selected.length === 0) return true;
  const canonical = canonicalModelFamily(value);
  return selected.some((candidate) => canonicalModelFamily(candidate) === canonical);
}
function matchesFilter(value, selected) {
  if (!selected || selected.length === 0) return true;
  return selected.includes(value);
}

function trialMatchesFilters(identity, family, filters) {
  return (
    matchesFilter(identity.benchmarkId, filters.benchmark) &&
    matchesFilter(
      `${identity.benchmarkId}\t${identity.benchmarkVersion}`,
      filters.benchmarkVersion,
    ) &&
    matchesFilter(identity.runnerFamily, filters.runner) &&
    matchesFilter(identity.provider, filters.provider) &&
    matchesModelFilter(identity.modelFamily, filters.model) &&
    matchesFilter(identity.agentFamily, filters.agent) &&
    matchesFilter(`${identity.agentFamily}\t${identity.agentVersion}`, filters.agentVersion) &&
    matchesFilter(identity.harnessFamily, filters.harness) &&
    matchesFilter(
      `${identity.harnessFamily}\t${identity.harnessVersion}`,
      filters.harnessVersion,
    ) &&
    matchesFilter(modelReasoning(identity), filters.reasoning) &&
    matchesFilter(family, filters.taskFamily)
  );
}

function metricAverage(row, metric) {
  return row[metric].observations ? row[metric].total / row[metric].observations : null;
}
function metricState() {
  return { total: 0, observations: 0 };
}

/** Return a complete, safe leaderboard layout from browser-provided preferences. */
export function normalizeColumnLayout(columnIds, saved, requiredIds = []) {
  const defaults = [...new Set(columnIds)];
  if (
    !saved ||
    typeof saved !== "object" ||
    saved.version !== 1 ||
    !Array.isArray(saved.order) ||
    !Array.isArray(saved.hidden)
  ) {
    return { version: 1, order: defaults, hidden: [] };
  }
  const known = new Set(defaults);
  const required = new Set(requiredIds);
  const order = [
    ...new Set(saved.order.filter((id) => typeof id === "string" && known.has(id))),
  ];
  for (const id of defaults) {
    if (!order.includes(id)) order.push(id);
  }
  const hidden = [
    ...new Set(
      saved.hidden.filter(
        (id) => typeof id === "string" && known.has(id) && !required.has(id),
      ),
    ),
  ];
  return { version: 1, order, hidden };
}

/** Move one column before or after another without losing any column ids. */
export function moveColumn(order, sourceId, targetId, after = false) {
  if (sourceId === targetId || !order.includes(sourceId) || !order.includes(targetId)) {
    return [...order];
  }
  const moved = order.filter((id) => id !== sourceId);
  const targetIndex = moved.indexOf(targetId);
  moved.splice(targetIndex + Number(after), 0, sourceId);
  return moved;
}

/** Average one reported metric across rows without treating missing trials as zero. */
export function observedMetricAverage(rows, metricName) {
  const observed = rows.reduce(
    (summary, row) => ({
      total: summary.total + (row[metricName]?.total ?? 0),
      observations: summary.observations + (row[metricName]?.observations ?? 0),
    }),
    metricState(),
  );
  return observed.observations ? observed.total / observed.observations : null;
}

/** Map a visible metric value to the shared worst-to-best colour scale. */
export function relativeQualityPosition(value, low, high, higherIsBetter) {
  const relative = high === low ? 0.5 : (value - low) / (high - low);
  return higherIsBetter ? relative : 1 - relative;
}

/** Score points delivered for one dollar of observed average model cost. */
export function qualityPerDollar(scorePoints, averageCost) {
  return Number.isFinite(scorePoints) && Number.isFinite(averageCost) && averageCost > 0
    ? scorePoints / averageCost
    : null;
}
function taskResult() {
  return {
    observations: 0,
    firstExactPasses: 0,
    finalExactPasses: 0,
    duration: metricState(),
  };
}

/**
 * Summarize one numeric sample with quartiles, so a reader can judge spread
 * instead of trusting a single average. Non-finite values are ignored.
 */
export function describeDistribution(values) {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (!sorted.length) return null;
  const quantile = (fraction) => {
    if (sorted.length === 1) return sorted[0];
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  return {
    count: sorted.length,
    min: sorted[0],
    p25: quantile(0.25),
    median: quantile(0.5),
    p75: quantile(0.75),
    max: sorted.at(-1),
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
  };
}

/** True only when a configuration covers the full published benchmark. */
export function fullBenchmarkRun(row) {
  return row.fullBenchmark === true ||
    (row.fullBenchmark == null && row.complete === true && row.coverage === 1);
}
function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}
/**
 * Score for the configurations that share one identity: a model, an agent, a
 * harness, or a reasoning mode.
 *
 * Only configurations that cover the full published benchmark contribute to
 * this score. Partial runs stay visible in individual configuration details.
 */
export function aggregateGroupScore(rows) {
  rows = rows.filter((row) => row.fullBenchmark !== false);
  if (!rows.length) {
    return {
      firstExactRate: null,
      finalExactRate: null,
      qualityScore: null,
      coverage: null,
      score: null,
      taskCount: 0,
      benchmarkTaskCount: 0,
      observations: 0,
    };
  }
  const observations = rows.reduce((sum, row) => sum + row.observations, 0);
  const weighted = (field) =>
    observations
      ? rows.reduce((sum, row) => sum + (row[field] ?? 0) * row.observations, 0) / observations
      : null;
  return {
    firstExactRate: weighted("firstExactRate"),
    finalExactRate: weighted("finalExactRate"),
    qualityScore: weighted("qualityScore"),
    coverage: weighted("coverage"),
    score: weighted("score"),
    taskCount: Math.max(...rows.map((row) => row.taskCount ?? 0)),
    benchmarkTaskCount: Math.max(...rows.map((row) => row.benchmarkTaskCount ?? 0)),
    observations,
  };
}

/**
 * Aggregate observed tool names by visible model and harness configuration.
 * Calls are joined through round and trial ids; active filters also define the
 * trial denominator used for calls-per-trial values.
 */
export function aggregateToolUsage(index, profiles, trials, rounds, toolCalls, filters = {}) {
  const runs = new Map(index.runs.map((run) => [run.runId, run]));
  const profileMap = new Map(
    profiles.map((profile) => [`${profile.runId}::${profile.profileId}`, profile]),
  );
  const selectedTrials = new Map();
  const groups = new Map();

  for (const trial of trials) {
    const run = runs.get(trial.runId);
    const profile = profileMap.get(`${trial.runId}::${trial.profileId}`);
    if (!run || !profile) continue;
    const identity = exactIdentity(profile, run);
    if (!trialMatchesFilters(identity, taskFamily(trial.taskId), filters)) continue;
    const model = modelRouteIdentity(identity);
    const key = JSON.stringify([model, identity.harnessFamily, identity.harnessVersion]);
    const runKey = JSON.stringify([trial.runId, model, identity.harnessFamily, identity.harnessVersion]);
    const group = groups.get(runKey) ?? {
      key,
      runId: trial.runId,
      model,
      harness: identity.harnessFamily,
      harnessVersion: identity.harnessVersion,
      trials: 0,
      calls: 0,
      toolCounts: new Map(),
    };
    group.trials += 1;
    groups.set(runKey, group);
    selectedTrials.set(`${trial.runId}::${trial.trialId}`, runKey);
  }

  const groupByRound = new Map();
  for (const round of rounds) {
    const key = selectedTrials.get(`${round.runId}::${round.trialId}`);
    if (key) groupByRound.set(`${round.runId}::${round.roundId}`, key);
  }
  for (const call of toolCalls) {
    const key = groupByRound.get(`${call.runId}::${call.roundId}`);
    const group = groups.get(key);
    if (!group || !call.tool) continue;
    group.calls += 1;
    group.toolCounts.set(call.tool, (group.toolCounts.get(call.tool) ?? 0) + 1);
  }

  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      model: group.model,
      runId: group.runId,
      harness: group.harness,
      harnessVersion: group.harnessVersion,
      trials: group.trials,
      calls: group.calls,
      callsPerTrial: group.calls / group.trials,
      tools: [...group.toolCounts]
        .map(([tool, calls]) => ({
          tool,
          calls,
          share: group.calls ? calls / group.calls : 0,
          callsPerTrial: calls / group.trials,
        }))
        .sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool)),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Count one tool per benchmark trial, including trials that never called it.
 * Trials are the honest denominator for "how often is this tool used".
 */
export function toolTrialCounts(index, profiles, trials, rounds, toolCalls, tool, filters = {}) {
  const runs = new Map(index.runs.map((run) => [run.runId, run]));
  const profileMap = new Map(
    profiles.map((profile) => [`${profile.runId}::${profile.profileId}`, profile]),
  );
  const selected = new Map();
  const result = [];

  for (const trial of trials) {
    const run = runs.get(trial.runId);
    const profile = profileMap.get(`${trial.runId}::${trial.profileId}`);
    if (!run || !profile) continue;
    const identity = exactIdentity(profile, run);
    if (!trialMatchesFilters(identity, taskFamily(trial.taskId), filters)) continue;
    const key = JSON.stringify([
      modelRouteIdentity(identity),
      identity.harnessFamily,
      identity.harnessVersion,
    ]);
    const entry = {
      key,
      runId: trial.runId,
      trialId: trial.trialId,
      taskId: trial.taskId,
      calls: 0,
    };
    selected.set(`${trial.runId}::${trial.trialId}`, entry);
    result.push(entry);
  }

  const entryByRound = new Map();
  for (const round of rounds) {
    const entry = selected.get(`${round.runId}::${round.trialId}`);
    if (entry) entryByRound.set(`${round.runId}::${round.roundId}`, entry);
  }
  for (const call of toolCalls) {
    if (call.tool !== tool) continue;
    const entry = entryByRound.get(`${call.runId}::${call.roundId}`);
    if (entry) entry.calls += 1;
  }
  return result;
}

/**
 * Aggregate accepted observations by run and exact configuration. Unlike the
 * published leaderboard view, repeated accepted runs stay separate so a
 * compact matrix cell can honestly use the last accepted run.
 */
export function aggregateRunConfigurations(index, profiles, trials, rounds, filters = {}) {
  const runs = new Map(index.runs.map((run) => [run.runId, run]));
  const profileMap = new Map(
    profiles.map((profile) => [`${profile.runId}::${profile.profileId}`, profile]),
  );
  const benchmarkTasks = new Map();
  const roundStats = new Map();

  for (const trial of trials) {
    const run = runs.get(trial.runId);
    if (!run) continue;
    const family = taskFamily(trial.taskId);
    if (!matchesFilter(family, filters.taskFamily)) continue;
    const definedTasks = run.definitions?.taskSet?.taskIds;
    const tasks =
      benchmarkTasks.get(trial.runId) ??
      new Set(
        Array.isArray(definedTasks)
          ? definedTasks.filter((taskId) => matchesFilter(taskFamily(taskId), filters.taskFamily))
          : [],
      );
    tasks.add(trial.taskId);
    benchmarkTasks.set(trial.runId, tasks);
  }

  for (const round of rounds) {
    const key = `${round.runId}::${round.trialId}`;
    const stats = roundStats.get(key) ?? {
      rounds: 0,
      duration: metricState(),
      cost: metricState(),
      tokens: metricState(),
    };
    stats.rounds += 1;
    for (const [name, field] of [
      ["duration", "seconds"],
      ["cost", "costUsd"],
      ["tokens", "totalTokens"],
    ]) {
      const value = round[field];
      if (typeof value === "number" && Number.isFinite(value)) {
        stats[name].total += value;
        stats[name].observations += 1;
      }
    }
    roundStats.set(key, stats);
  }

  const groups = new Map();
  for (const trial of trials) {
    const run = runs.get(trial.runId);
    const profile = profileMap.get(`${trial.runId}::${trial.profileId}`);
    if (!run || !profile) continue;
    const family = taskFamily(trial.taskId);
    const identity = exactIdentity(profile, run);
    if (!trialMatchesFilters(identity, family, filters)) continue;
    const key = JSON.stringify([trial.runId, identity]);
    const group = groups.get(key) ?? {
      ...identity,
      runId: trial.runId,
      observations: 0,
      tasks: new Map(),
      taskFamilies: new Set(),
      trialSamples: [],
      recoveryRounds: 0,
      duration: metricState(),
      cost: metricState(),
      tokens: metricState(),
    };
    group.observations += 1;
    const task = group.tasks.get(trial.taskId) ?? taskResult();
    task.observations += 1;
    task.firstExactPasses += Number(trial.firstExactPassed === true);
    task.finalExactPasses += Number(trial.finalExactPassed === true);
    group.tasks.set(trial.taskId, task);
    group.taskFamilies.add(family);
    group.recoveryRounds += Math.max(0, trial.rounds - 1);
    const sample = {
      taskId: trial.taskId,
      firstExactPassed: trial.firstExactPassed === true,
      finalExactPassed: trial.finalExactPassed === true,
      seconds: null,
      costUsd: null,
      tokens: null,
    };
    const stats = roundStats.get(`${trial.runId}::${trial.trialId}`);
    if (stats && stats.rounds === trial.rounds) {
      for (const name of metricNames) {
        if (stats[name].observations === stats.rounds) {
          group[name].total += stats[name].total;
          group[name].observations += 1;
          sample[SAMPLE_FIELDS[name]] = stats[name].total;
          if (name === "duration") {
            task.duration.total += stats[name].total;
            task.duration.observations += 1;
          }
        }
      }
    }
    group.trialSamples.push(sample);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const taskResults = [...group.tasks.values()];
    const firstExactRate = mean(
      taskResults.map((task) => task.firstExactPasses / task.observations),
    );
    const finalExactRate = mean(
      taskResults.map((task) => task.finalExactPasses / task.observations),
    );
    const qualityScore =
      firstExactRate == null || finalExactRate == null
        ? null
        : 0.75 * firstExactRate + 0.25 * finalExactRate;
    const taskCount = group.tasks.size;
    const benchmarkTaskCount = benchmarkTasks.get(group.runId)?.size ?? taskCount;
    const coverage = benchmarkTaskCount ? taskCount / benchmarkTaskCount : null;
    return {
      ...group,
      tasks: undefined,
      firstExactRate,
      finalExactRate,
      recoveryGain:
        firstExactRate == null || finalExactRate == null ? null : finalExactRate - firstExactRate,
      qualityScore,
      coverage,
      score: qualityScore == null || coverage == null ? null : qualityScore * coverage,
      taskCount,
      benchmarkTaskCount,
      complete: taskCount === benchmarkTaskCount,
      durationSummary: {
        averageCase: metricAverage(group, "duration"),
        totalObserved: group.duration.observations ? group.duration.total : null,
        coveredTasks: taskResults.filter((task) => task.duration.observations > 0).length,
      },
      taskFamilies: [...group.taskFamilies].sort(),
      runIds: [group.runId],
      configurationHashes: [group.configurationHash],
      submissionIds: runIdToSubmission(index, group.runId),
    };
  });
}

/** Mark run rows against the published whole-benchmark task count, not their local task sets. */
export function markFullBenchmarkRows(runRows, views) {
  const benchmarkTasks = Math.max(0, ...views.leaderboard.map((row) => row.benchmarkTaskCount ?? 0));
  const full = new Set(runRows.all.filter((row) => benchmarkTasks > 0 &&
    row.taskCount === benchmarkTasks).map((row) => `${row.runId}\t${row.configurationHash}`));
  for (const rows of Object.values(runRows)) for (const row of rows)
    row.fullBenchmark = full.has(`${row.runId}\t${row.configurationHash}`);
  return [...full];
}
/** Filter pre-aggregated run configurations without re-reading benchmark trials. */
export function filterSnapshotRunRows(snapshot, filters = {}) {
  const families = filters.taskFamily ?? [];
  const rows = families.length === 1 ? snapshot.runRows[families[0]] ?? [] :
    families.length ? aggregateRunConfigurations(snapshot.index, snapshot.profiles,
      snapshot.trials, snapshot.rounds, { taskFamily: families }) : snapshot.runRows.all;
  return rows.filter((row) => trialMatchesFilters(row, row.taskFamilies[0],
    { ...filters, taskFamily: [] }));
}
function runIdToSubmission(index, runId) {
  const submissionId = index.runs.find((run) => run.runId === runId)?.submissionId;
  return submissionId ? [submissionId] : [];
}
export function precomputedFamilyScore(row, family) {
  const candidates = precomputedViews?.taskFamilies?.[family] ?? [];
  return (
    candidates.find((candidate) =>
      candidate.configurationHashes?.some((hash) => row.configurationHashes?.includes(hash)),
    ) ??
    candidates.find(
      (candidate) =>
        modelRouteIdentity(candidate) === modelRouteIdentity(row) &&
        candidate.harnessFamily === row.harnessFamily &&
        candidate.harnessVersion === row.harnessVersion,
    ) ??
    null
  );
}
function leaderboardRowsForFamilies(rows, families) {
  const wanted = new Set(families);
  const benchmarkTasks = new Set(rows.flatMap((row) =>
    (row.configurationTaskCells ?? []).filter((cell) => wanted.has(taskFamily(cell.taskId)))
      .map((cell) => cell.taskId)));
  return rows.flatMap((row) => {
    const byTask = new Map();
    for (const cell of row.configurationTaskCells ?? []) {
      if (!wanted.has(taskFamily(cell.taskId))) continue;
      const values = byTask.get(cell.taskId) ?? [];
      values.push(cell);
      byTask.set(cell.taskId, values);
    }
    if (!byTask.size) return [];
    const tasks = [...byTask.values()].map((cells) => ({
      firstExactRate: mean(cells.map((cell) => cell.firstExactRate)),
      finalExactRate: mean(cells.map((cell) => cell.finalExactRate)),
      observations: cells.reduce((total, cell) => total + (cell.observations ?? 0), 0),
    }));
    const firstExactRate = mean(tasks.map((task) => task.firstExactRate));
    const finalExactRate = mean(tasks.map((task) => task.finalExactRate));
    const qualityScore = 0.75 * firstExactRate + 0.25 * finalExactRate;
    const coverage = benchmarkTasks.size ? byTask.size / benchmarkTasks.size : 0;
    return [{
      ...row,
      firstExactRate,
      finalExactRate,
      recoveryGain: finalExactRate - firstExactRate,
      qualityScore,
      coverage,
      score: qualityScore * coverage,
      observations: tasks.reduce((total, task) => total + task.observations, 0),
      taskCount: byTask.size,
      benchmarkTaskCount: benchmarkTasks.size,
      complete: coverage === 1,
      taskFamilies: [...wanted].sort(),
    }];
  });
}

/**
 * Build a configurable leaderboard. Empty benchmark and reasoning filters mean
 * “All”: exact observations roll up by reasoning, benchmark version and family.
 */
export function aggregateLeaderboard(_index, _profiles, _trials, _rounds, filters = {}) {
  if (!precomputedViews) throw Error("Precomputed views have not been loaded");
  const families = filters.taskFamily ?? [];
  const rows = families.length === 1
    ? precomputedViews.taskFamilies[families[0]] ?? []
    : families.length > 1
      ? leaderboardRowsForFamilies(precomputedViews.leaderboard, families)
      : precomputedViews.leaderboard;
  const full = new Set(precomputedViews.fullRunKeys ??
    precomputedViews.leaderboard.filter(fullBenchmarkRun)
      .flatMap((row) => (row.runIds ?? []).flatMap((runId) =>
        (row.configurationHashes ?? []).map((hash) => `${runId}\t${hash}`))));
  const complete = (row) => (row.runIds ?? []).some((runId) =>
    (row.configurationHashes ?? []).some((hash) => full.has(`${runId}\t${hash}`)));
  const selected = (actual, expected) => !expected?.length || expected.includes(actual);
  const filtered = rows.filter((row) =>
    selected(row.provider, filters.provider) &&
    (!filters.model?.length ||
      filters.model.some(
        (model) => canonicalModelFamily(model) === canonicalModelFamily(row.modelFamily),
      )) &&
    selected(modelReasoning(row), filters.reasoning) &&
    selected(row.agentFamily, filters.agent) &&
    selected(`${row.agentFamily}\t${row.agentVersion}`, filters.agentVersion) &&
    selected(row.harnessFamily, filters.harness) &&
    selected(`${row.harnessFamily}\t${row.harnessVersion}`, filters.harnessVersion) &&
    selected(row.runnerFamily, filters.runner)
  );
  const direction = filters.sortDirection === "asc" ? 1 : -1;
  const field = {
    evidence: "coverage",
    reasoning: "thinking",
    model: "modelFamily",
    agent: "agentFamily",
    harness: "harnessFamily",
    duration: "durationSummary.averageCase",
  }[filters.sortBy] ?? filters.sortBy ?? "score";
  const get = (row) => field === "score" && !complete(row) ? null :
    field.split(".").reduce((item, key) => item?.[key], row);
  return filtered.toSorted((left, right) => {
    const a = get(left);
    const b = get(right);
    if (a == null || b == null) return Number(a == null) - Number(b == null);
    if (typeof a === "number" && typeof b === "number") return (a - b) * direction;
    return String(a).localeCompare(String(b)) * direction;
  }).map((row) => ({ ...row, fullBenchmark: complete(row) }));
}
/** Build sorted filter choices from published run and profile identities. */
export function filterOptions(index, profiles, trials) {
  const runs = new Map(index.runs.map((run) => [run.runId, run]));
  const choices = {
    benchmarks: new Set(),
    runners: new Set(),
    providers: new Set(),
    models: new Set(),
    agents: new Set(),
    agentVersions: new Set(),
    harnesses: new Set(),
    harnessVersions: new Set(),
    benchmarkVersions: new Set(),
    reasoning: new Set(),
    taskFamilies: new Set(),
  };
  for (const profile of profiles) {
    const run = runs.get(profile.runId);
    if (!run) continue;
    const identity = exactIdentity(profile, run);
    choices.benchmarks.add(identity.benchmarkId);
    if (identity.benchmarkVersion)
      choices.benchmarkVersions.add(`${identity.benchmarkId}\t${identity.benchmarkVersion}`);
    if (identity.runnerFamily) choices.runners.add(identity.runnerFamily);
    if (identity.provider) choices.providers.add(identity.provider);
    choices.models.add(canonicalModelFamily(identity.modelFamily));
    if (identity.agentFamily) choices.agents.add(identity.agentFamily);
    if (identity.agentVersion)
      choices.agentVersions.add(`${identity.agentFamily}\t${identity.agentVersion}`);
    choices.harnesses.add(identity.harnessFamily);
    if (identity.harnessVersion)
      choices.harnessVersions.add(`${identity.harnessFamily}\t${identity.harnessVersion}`);
    choices.reasoning.add(modelReasoning(identity));
  }
  for (const trial of trials) choices.taskFamilies.add(taskFamily(trial.taskId));
  return Object.fromEntries(
    Object.entries(choices).map(([key, values]) => [
      key,
      [...values].sort((left, right) => {
        if (key !== "reasoning") return left.localeCompare(right);
        return reasoningOrder.indexOf(left) - reasoningOrder.indexOf(right);
      }),
    ]),
  );
}
