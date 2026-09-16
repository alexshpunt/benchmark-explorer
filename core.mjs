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
  return versions.sort(compareVersions).at(-1) ?? null;
}

function compareVersions(left, right) {
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
    filters,
  };
}

/**
 * Build a stable query string for a shareable explorer state.
 * @param {Record<string, string | undefined>} selection
 * @param {{comparison?: string, groupBy?: string[], reference?: string | null, sortBy?: string, sortDirection?: string, filters?: Record<string, string[]>} | null} [controls]
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
    matchesFilter(identity.thinking, filters.reasoning) &&
    matchesFilter(family, filters.taskFamily)
  );
}

function compareNullable(left, right, direction, selector) {
  const leftValue = selector(left);
  const rightValue = selector(right);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * direction;
  }
  return (
    String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true }) * direction
  );
}

function metricAverage(row, metric) {
  return row[metric].observations ? row[metric].total / row[metric].observations : null;
}
function metricState() {
  return { total: 0, observations: 0 };
}

function benchmarkKey(identity) {
  return JSON.stringify([identity.benchmarkId, identity.benchmarkVersion]);
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

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}
/**
 * Score for the configurations that share one identity: a model, an agent, a
 * harness, or a reasoning mode.
 *
 * Trials are pooled per benchmark task, so a configuration that ran only a few
 * tasks adds evidence instead of dragging the group down. Averaging the
 * configuration scores instead let a one-task run cost a model 9.7 points while
 * contributing a single observation. Coverage is still the share of the
 * benchmark the group has been measured on at all, so a group without enough
 * evidence scores low rather than looking complete.
 */
export function aggregateGroupScore(rows) {
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
    const model = canonicalModelFamily(identity.modelFamily);
    const key = JSON.stringify([model, identity.harnessFamily, identity.harnessVersion]);
    const group = groups.get(key) ?? {
      key,
      model,
      harness: identity.harnessFamily,
      harnessVersion: identity.harnessVersion,
      trials: 0,
      calls: 0,
      toolCounts: new Map(),
    };
    group.trials += 1;
    groups.set(key, group);
    selectedTrials.set(`${trial.runId}::${trial.trialId}`, key);
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
      canonicalModelFamily(identity.modelFamily),
      identity.harnessFamily,
      identity.harnessVersion,
    ]);
    const entry = { key, trialId: trial.trialId, taskId: trial.taskId, calls: 0 };
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
 * Join normalized profiles, trials and rounds and aggregate selected trials by
 * exact published configuration. Missing efficiency values stay missing.
 */


function rollupIdentity(row) {
  return {
    modelFamily: row.modelFamily,
    modelVersion: row.modelVersion,
    agentFamily: row.agentFamily,
    agentVersion: row.agentVersion,
    harnessFamily: row.harnessFamily,
    harnessVersion: row.harnessVersion,
    provider: row.provider,
    configurationLabels: row.configurationLabels,
    transport: row.transport,
    harnessKind: row.harnessKind,
    adapterVersion: row.adapterVersion,
  };
}

function hierarchicalMean(families, selector) {
  return mean(
    [...families.values()].map((versions) =>
      mean(
        [...versions.values()].map((reasoningRows) =>
          mean(reasoningRows.map(selector).filter((value) => value != null)),
        ),
      ),
    ),
  );
}
function averageMetric(rows, name) {
  return rows.reduce(
    (metric, row) => ({
      total: metric.total + row[name].total,
      observations: metric.observations + row[name].observations,
    }),
    metricState(),
  );
}

/** Return one precomputed task-family row for an accepted configuration. */
export function precomputedFamilyScore(row, family) {
  const candidates = precomputedViews?.taskFamilies?.[family] ?? [];
  return (
    candidates.find((candidate) =>
      candidate.configurationHashes?.some((hash) => row.configurationHashes?.includes(hash)),
    ) ??
    candidates.find(
      (candidate) =>
        canonicalModelFamily(candidate.modelFamily) === canonicalModelFamily(row.modelFamily) &&
        candidate.harnessFamily === row.harnessFamily &&
        candidate.harnessVersion === row.harnessVersion,
    ) ??
    null
  );
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
    : precomputedViews.leaderboard;
  const selected = (actual, expected) => !expected?.length || expected.includes(actual);
  const filtered = rows.filter((row) =>
    selected(row.provider, filters.provider) &&
    (!filters.model?.length ||
      filters.model.some(
        (model) => canonicalModelFamily(model) === canonicalModelFamily(row.modelFamily),
      )) &&
    selected(row.thinking, filters.reasoning) &&
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
  const get = (row) => field.split(".").reduce((item, key) => item?.[key], row);
  return filtered.toSorted((left, right) => {
    const a = get(left);
    const b = get(right);
    if (typeof a === "number" && typeof b === "number") return (a - b) * direction;
    return String(a ?? "").localeCompare(String(b ?? "")) * direction;
  });
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
    if (identity.thinking) choices.reasoning.add(identity.thinking);
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
