const metricNames = ["duration", "cost", "tokens"];
/** Per-trial sample fields for each observed metric. */
const SAMPLE_FIELDS = { duration: "seconds", cost: "costUsd", tokens: "tokens" };
const reasoningOrder = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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

const DEFAULT_HARNESSES = {
  vanilla: "pi-default",
  opencode: "opencode-default",
  omp: "oh-my-pi-default",
  copilot: "github-copilot-cli-default",
  codex: "codex-cli-default",
};

function publicAgentHarness(profile) {
  if (profile.agentFamily === "pi-agent-ide" && profile.harnessFamily === "ide") {
    return {
      agentFamily: "pi",
      agentVersion: profile.harnessVersion ?? null,
      harnessFamily: "pi-agent-ide",
      harnessVersion: profile.agentVersion ?? null,
    };
  }
  return {
    agentFamily: profile.agentFamily ?? null,
    agentVersion: profile.agentVersion ?? null,
    harnessFamily:
      DEFAULT_HARNESSES[profile.harnessFamily] ?? profile.harnessFamily ?? profile.harnessId,
    harnessVersion: profile.harnessVersion ?? null,
  };
}
function exactIdentity(profile, run) {
  const benchmark = run.definitions?.benchmark;
  const agentHarness = publicAgentHarness(profile);
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
  const tasks = new Map();
  let observations = 0;
  for (const row of rows) {
    for (const sample of row.trialSamples ?? []) {
      const item = tasks.get(sample.taskId) ?? {
        observations: 0,
        firstPasses: 0,
        finalPasses: 0,
      };
      item.observations += 1;
      item.firstPasses += Number(sample.firstExactPassed);
      item.finalPasses += Number(sample.finalExactPassed);
      tasks.set(sample.taskId, item);
      observations += 1;
    }
  }
  const perTask = [...tasks.values()];
  const firstExactRate = mean(perTask.map((task) => task.firstPasses / task.observations));
  const finalExactRate = mean(perTask.map((task) => task.finalPasses / task.observations));
  const qualityScore =
    firstExactRate == null || finalExactRate == null
      ? null
      : 0.75 * firstExactRate + 0.25 * finalExactRate;
  // The benchmark size, not the sum per configuration: one task counts once.
  const benchmarkTaskCount = Math.max(0, ...rows.map((row) => row.benchmarkTaskCount ?? 0));
  const coverage = benchmarkTaskCount ? tasks.size / benchmarkTaskCount : null;
  return {
    firstExactRate,
    finalExactRate,
    qualityScore,
    coverage,
    score: qualityScore == null || coverage == null ? null : qualityScore * coverage,
    taskCount: tasks.size,
    benchmarkTaskCount,
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
export function aggregateExactConfigurations(index, profiles, trials, rounds, filters = {}) {
  const runs = new Map(index.runs.map((run) => [run.runId, run]));
  const profileMap = new Map(
    profiles.map((profile) => [`${profile.runId}::${profile.profileId}`, profile]),
  );
  const roundStats = new Map();
  const benchmarkTasks = new Map();

  for (const trial of trials) {
    const run = runs.get(trial.runId);
    if (!run) continue;
    const family = taskFamily(trial.taskId);
    if (!matchesFilter(family, filters.taskFamily)) continue;
    const benchmark = run.definitions?.benchmark;
    const key = JSON.stringify([benchmark?.id ?? run.contract, benchmark?.version ?? null]);
    const tasks = benchmarkTasks.get(key) ?? new Set();
    tasks.add(trial.taskId);
    benchmarkTasks.set(key, tasks);
  }

  for (const round of rounds) {
    const key = `${round.runId}::${round.trialId}`;
    const stats = roundStats.get(key) ?? {
      rounds: 0,
      timeouts: 0,
      duration: metricState(),
      cost: metricState(),
      tokens: metricState(),
    };
    stats.rounds += 1;
    stats.timeouts += Number(round.timedOut === true);
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

    const key = JSON.stringify(identity);
    const group = groups.get(key) ?? {
      ...identity,
      observations: 0,
      firstExactPasses: 0,
      finalExactPasses: 0,
      tasks: new Map(),
      taskFamilies: new Set(),
      runIds: new Set(),
      sourceProfiles: new Set(),
      trialSamples: [],
      submissionIds: new Set(),
      recoveryRounds: 0,
      timeouts: 0,
      infrastructureFailures: 0,
      duration: metricState(),
      cost: metricState(),
      tokens: metricState(),
    };
    group.observations += 1;
    group.firstExactPasses += Number(trial.firstExactPassed === true);
    group.finalExactPasses += Number(trial.finalExactPassed === true);
    const task = group.tasks.get(trial.taskId) ?? taskResult();
    task.observations += 1;
    task.firstExactPasses += Number(trial.firstExactPassed === true);
    task.finalExactPasses += Number(trial.finalExactPassed === true);
    group.tasks.set(trial.taskId, task);
    group.taskFamilies.add(family);
    group.runIds.add(trial.runId);
    group.sourceProfiles.add(profile.profileId);
    if (run.submissionId) group.submissionIds.add(run.submissionId);
    group.recoveryRounds += Math.max(0, trial.rounds - 1);
    group.infrastructureFailures += Number(Boolean(trial.infrastructureFailure));

    // One honest per-trial record: it explains pass rates, spread and efficiency.
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
      group.timeouts += stats.timeouts;
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

  return [...groups.values()]
    .map((group) => {
      const taskResults = [...group.tasks.values()];
      const firstExactRate = mean(
        taskResults.map((task) => task.firstExactPasses / task.observations),
      );
      const finalExactRate = mean(
        taskResults.map((task) => task.finalExactPasses / task.observations),
      );
      const durationByTask = taskResults
        .filter((task) => task.duration.observations > 0)
        .map((task) => task.duration.total / task.duration.observations);
      const taskCount = group.tasks.size;
      const benchmarkTaskCount = benchmarkTasks.get(benchmarkKey(group))?.size ?? taskCount;
      const qualityScore =
        firstExactRate == null || finalExactRate == null
          ? null
          : 0.75 * firstExactRate + 0.25 * finalExactRate;
      const coverage = benchmarkTaskCount ? taskCount / benchmarkTaskCount : null;
      return {
        ...group,
        tasks: undefined,
        firstExactRate,
        finalExactRate,
        recoveryGain:
          firstExactRate == null || finalExactRate == null ? null : finalExactRate - firstExactRate,
        qualityScore,
        score: qualityScore == null || coverage == null ? null : qualityScore * coverage,
        taskCount,
        benchmarkTaskCount,
        coverage,
        complete: taskCount === benchmarkTaskCount,
        durationSummary: {
          averageCase: metricAverage(group, "duration"),
          coveredRun:
            durationByTask.length === taskCount
              ? durationByTask.reduce((total, value) => total + value, 0)
              : null,
          totalObserved: group.duration.observations ? group.duration.total : null,
          coveredTasks: durationByTask.length,
        },
        taskFamilies: [...group.taskFamilies].sort(),
        runIds: [...group.runIds].sort(),
        sourceProfiles: [...group.sourceProfiles].sort(),
        submissionIds: [...group.submissionIds].sort(),
      };
    })
    .sort((left, right) => {
      const sortBy = filters.sortBy ?? "score";
      const direction = filters.sortDirection === "asc" ? 1 : -1;
      const selectors = {
        score: (row) => row.score,
        evidence: (row) => row.coverage,
        firstExactRate: (row) => row.firstExactRate,
        finalExactRate: (row) => row.finalExactRate,
        recoveryGain: (row) => row.recoveryGain,
        observations: (row) => row.observations,
        model: (row) => row.modelFamily,
        agent: (row) => row.agentFamily,
        harness: (row) => row.harnessFamily,
        reasoning: (row) => {
          const order = reasoningOrder.indexOf(row.thinking);
          return order < 0 ? null : order;
        },
        benchmark: (row) => row.benchmarkId,
        duration: (row) => metricAverage(row, "duration"),
        cost: (row) => metricAverage(row, "cost"),
        tokens: (row) => metricAverage(row, "tokens"),
        config: (row) => row.configurationHash,
      };
      const versionFamilies = {
        agentVersion: "agent",
        harnessVersion: "harness",
        benchmarkVersion: "benchmark",
      };
      const familySort = versionFamilies[sortBy];
      if (familySort) {
        return (
          compareNullable(left, right, 1, selectors[familySort]) ||
          compareNullable(left, right, direction, (row) => row[sortBy]) ||
          right.observations - left.observations
        );
      }
      if (sortBy === "score" && left.complete !== right.complete) {
        return left.complete ? -1 : 1;
      }
      return (
        compareNullable(left, right, direction, selectors[sortBy] ?? selectors.score) ||
        right.observations - left.observations ||
        left.modelFamily.localeCompare(right.modelFamily)
      );
    });
}

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

/**
 * Build a configurable leaderboard. Empty benchmark and reasoning filters mean
 * “All”: exact observations roll up by reasoning, benchmark version and family.
 */
export function aggregateLeaderboard(index, profiles, trials, rounds, filters = {}) {
  const exactRows = aggregateExactConfigurations(index, profiles, trials, rounds, filters);
  const groups = new Map();
  for (const row of exactRows) {
    const identity = rollupIdentity(row);
    const key = JSON.stringify(identity);
    const group = groups.get(key) ?? { ...identity, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  const rolled = [...groups.values()].map((group) => {
    const families = new Map();
    for (const row of group.rows) {
      const versions = families.get(row.benchmarkId) ?? new Map();
      const values = versions.get(row.benchmarkVersion) ?? [];
      values.push(row);
      versions.set(row.benchmarkVersion, values);
      families.set(row.benchmarkId, versions);
    }
    const qualityScore = hierarchicalMean(families, (row) => row.qualityScore);
    const runIds = new Set(group.rows.flatMap((row) => row.runIds));
    const submissionIds = new Set(group.rows.flatMap((row) => row.submissionIds));
    const configurationHashes = new Set(group.rows.map((row) => row.configurationHash));
    const reasoningModes = new Set(group.rows.map((row) => row.thinking));
    const representedVersions = new Set(
      group.rows.map((row) => `${row.benchmarkId}\t${row.benchmarkVersion ?? ""}`),
    );
    const coverage = mean(group.rows.map((row) => row.coverage)) ?? 0;
    const duration = averageMetric(group.rows, "duration");
    const coveredRuns = group.rows
      .map((row) => row.durationSummary.coveredRun)
      .filter((value) => value != null);
    const selectedBenchmark = filters.benchmark?.length === 1 ? filters.benchmark[0] : null;
    const selectedReasoning = filters.reasoning?.length === 1 ? filters.reasoning[0] : null;
    return {
      ...group,
      rows: undefined,
      qualityScore,
      score: qualityScore == null ? null : qualityScore * coverage,
      firstExactRate: hierarchicalMean(families, (row) => row.firstExactRate),
      finalExactRate: hierarchicalMean(families, (row) => row.finalExactRate),
      recoveryGain: hierarchicalMean(families, (row) => row.recoveryGain),
      observations: group.rows.reduce((total, row) => total + row.observations, 0),
      trialSamples: group.rows.flatMap((row) => row.trialSamples ?? []),
      recoveryRounds: group.rows.reduce((total, row) => total + row.recoveryRounds, 0),
      taskCount: group.rows.reduce((total, row) => total + row.taskCount, 0),
      benchmarkTaskCount: group.rows.reduce((total, row) => total + row.benchmarkTaskCount, 0),
      coverage,
      complete: coverage === 1,
      benchmarkFamilyCount: families.size,
      benchmarkIds: [...families.keys()].sort(),
      benchmarkVersionCount: representedVersions.size,
      reasoningModeCount: reasoningModes.size,
      evidenceUnit: reasoningModes.size > 1 ? "task-modes" : "tasks",
      benchmarkId:
        selectedBenchmark ??
        `All · ${families.size} ${families.size === 1 ? "family" : "families"}`,
      benchmarkVersion:
        filters.benchmarkVersion?.length === 1
          ? filters.benchmarkVersion[0].split("\t")[1]
          : `${representedVersions.size} ${representedVersions.size === 1 ? "version" : "versions"}`,
      thinking:
        selectedReasoning ??
        (reasoningModes.size === 1
          ? ([...reasoningModes][0] ?? "unknown")
          : `All · ${reasoningModes.size} modes`),
      contract: group.rows.map((row) => row.contract).join(", "),
      runnerFamily: null,
      runnerVersion: null,
      configurationHash: configurationHashes.size === 1 ? [...configurationHashes][0] : "aggregate",
      configurationHashes: [...configurationHashes].sort(),
      runIds: [...runIds].sort(),
      submissionIds: [...submissionIds].sort(),
      duration,
      cost: averageMetric(group.rows, "cost"),
      tokens: averageMetric(group.rows, "tokens"),
      durationSummary: {
        averageCase: metricAverage({ duration }, "duration"),
        coveredRun: coveredRuns.length ? mean(coveredRuns) : null,
        totalObserved: duration.observations ? duration.total : null,
        coveredTasks: group.rows.reduce(
          (total, row) => total + row.durationSummary.coveredTasks,
          0,
        ),
      },
    };
  });

  return rolled.sort((left, right) => {
    const sortBy = filters.sortBy ?? "score";
    const direction = filters.sortDirection === "asc" ? 1 : -1;
    const selectors = {
      score: (row) => row.score,
      evidence: (row) => row.coverage,
      observations: (row) => row.observations,
      model: (row) => row.modelFamily,
      agent: (row) => row.agentFamily,
      agentVersion: (row) => row.agentVersion,
      harness: (row) => row.harnessFamily,
      harnessVersion: (row) => row.harnessVersion,
      reasoning: (row) => row.thinking,
      benchmark: (row) => row.benchmarkId,
      benchmarkVersion: (row) => row.benchmarkVersion,
      duration: (row) => metricAverage(row, "duration"),
      cost: (row) => metricAverage(row, "cost"),
      tokens: (row) => metricAverage(row, "tokens"),
      config: (row) => row.configurationHash,
    };
    if (sortBy === "score" && left.complete !== right.complete) return left.complete ? -1 : 1;
    if (sortBy === "score" && left.coverage !== right.coverage)
      return right.coverage - left.coverage;
    return (
      compareNullable(left, right, direction, selectors[sortBy] ?? selectors.score) ||
      left.modelFamily.localeCompare(right.modelFamily)
    );
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
