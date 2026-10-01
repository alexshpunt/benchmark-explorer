import { modelIdentity, modelLabel, compareHarnessVersions, median, modelRouteIdentity } from "../core.mjs";

/** Median full-run score, with one vote per run and model-provider-reasoning route. */
export function combinationScore(rows) {
  const runs = new Map();
  for (const row of rows) {
    if (!row.fullBenchmark || !Number.isFinite(row.score)) continue;
    const key = JSON.stringify([row.runId, modelRouteIdentity(row)]);
    runs.set(key, [...(runs.get(key) ?? []), row.score]);
  }
  return median([...runs.values()].map(median));
}

/** Display-only grouped score: one median per provider-reasoning route, then one group median. */
export function groupedScore(cells) {
  const routes = new Map();
  for (const cell of cells) routes.set(cell.model, [...(routes.get(cell.model) ?? []), cell.score]);
  return median([...routes.values()].map(median));
}
/** Model score: one vote per harness, regardless of repeat count. */
export function modelScore(combinations) {
  return median(combinations.map((item) => item.score));
}

/** Latest complete harness version separately for each model-provider-reasoning route. */
export function scoredCombinations(rows) {
  const pairs = new Map();
  for (const row of rows) {
    if (!row.fullBenchmark || !Number.isFinite(row.score)) continue;
    const key = JSON.stringify([row.harnessFamily, modelRouteIdentity(row)]);
    pairs.set(key, [...(pairs.get(key) ?? []), row]);
  }
  return [...pairs.values()].map((members) => {
    const version = members.map((row) => row.harnessVersion ?? "").sort(compareHarnessVersions).at(-1);
    const sourceRows = members.filter((row) => (row.harnessVersion ?? "") === version);
    return { harness: members[0].harnessFamily, route: modelRouteIdentity(members[0]),
      model: modelLabel(members[0]), modelKey: modelIdentity(members[0]), version,
      score: combinationScore(sourceRows), sourceRows };
  });
}

/** Aggregate a model's latest combinations with one vote per harness. */
export function modelRowsScore(rows) {
  const byHarness = new Map();
  for (const item of scoredCombinations(rows))
    byHarness.set(item.harness, [...(byHarness.get(item.harness) ?? []), ...item.sourceRows]);
  return modelScore([...byHarness.values()].map((sourceRows) => ({ score: combinationScore(sourceRows) })));
}
/** Fixed baseline route universe; missing results contribute zero delta, never source data. */
export function baselineHarnessScores(rows, _acceptedRunIds = [], baselineHarness = "baseline-agent") {
  const combinations = scoredCombinations(rows);
  const baselines = new Map(combinations.filter((item) => item.harness === baselineHarness)
    .map((item) => [item.route, { score: item.score, version: item.version, rows: item.sourceRows }]));
  const models = baselines.size;
  const baselineMean = models ? [...baselines.values()].reduce((sum, item) => sum + item.score, 0) / models : null;
  const harnesses = new Map();
  if (models) for (const harness of new Set(combinations.map((item) => item.harness))) {
    const matched = combinations.filter((item) => item.harness === harness && baselines.has(item.route));
    const delta = matched.reduce((sum, item) => sum + item.score - baselines.get(item.route).score, 0) / models;
    harnesses.set(harness, { score: baselineMean + delta, delta, covered: matched.length,
      coverage: matched.length / models, models: matched.map((item) => item.route), total: models,
      version: null, rows: matched.flatMap((item) => item.sourceRows) });
  }
  return { baselineHarness, baselineMean, models, baselines, harnesses };
}
