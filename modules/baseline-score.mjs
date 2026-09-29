import { compareHarnessVersions, median, modelRouteIdentity } from "../core.mjs";

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Rank harnesses against a common set of full baseline model-provider routes.
 * Missing routes have zero delta, not zero score. No source row is imputed.
 * The baseline harness can be changed without changing this calculation.
 */
export function baselineHarnessScores(rows, acceptedRunIds, baselineHarness = "baseline-agent") {
  const order = new Map(acceptedRunIds.map((id, index) => [id, index]));
  const full = rows.filter((row) => row.fullBenchmark && Number.isFinite(row.score));
  const harnessVersions = new Map();
  for (const row of full) {
    if (row.harnessFamily === baselineHarness) continue;
    const version = row.harnessVersion ?? "";
    const previous = harnessVersions.get(row.harnessFamily);
    if (previous == null || compareHarnessVersions(version, previous) > 0)
      harnessVersions.set(row.harnessFamily, version);
  }
  // The baseline is the last complete run on each route, even if it uses an
  // older harness version than the most recent baseline run on another route.
  const selected = new Map();
  for (const row of full) {
    const harness = row.harnessFamily;
    if (harness !== baselineHarness && (row.harnessVersion ?? "") !== harnessVersions.get(harness)) continue;
    const route = modelRouteIdentity(row);
    const key = JSON.stringify([harness, route]);
    const previous = selected.get(key);
    if (harness !== baselineHarness) {
      if (previous) previous.rows.push(row);
      else selected.set(key, { runId: row.runId, version: row.harnessVersion ?? "", rows: [row] });
    } else if (!previous || (order.get(row.runId) ?? -1) > (order.get(previous.runId) ?? -1)) {
      selected.set(key, { runId: row.runId, version: row.harnessVersion ?? "", rows: [row] });
    }
  }
  // Pool all repeats of each route's selected baseline version, regardless of input order.
  for (const [key, result] of selected) {
    const [harness, route] = JSON.parse(key);
    if (harness === baselineHarness) result.rows = full.filter((row) =>
      row.harnessFamily === harness && modelRouteIdentity(row) === route &&
      (row.harnessVersion ?? "") === result.version);
  }
  const byHarness = new Map();
  for (const [key, result] of selected) {
    const [harness, route] = JSON.parse(key);
    const scores = byHarness.get(harness) ?? new Map();
    const runs = new Map();
    for (const row of result.rows) {
      const id = row.runId ?? "unknown";
      runs.set(id, [...(runs.get(id) ?? []), row.score]);
    }
    scores.set(route, { score: median([...runs.values()].map(median)),
      version: result.version, rows: result.rows });
    byHarness.set(harness, scores);
  }
  const baselines = byHarness.get(baselineHarness) ?? new Map();
  const models = baselines.size;
  const baselineMean = models ? mean([...baselines.values()].map((result) => result.score)) : null;
  if (!models) return { baselineHarness, baselineMean, models, baselines, harnesses: new Map() };
  const harnesses = new Map();
  for (const [harness, results] of byHarness) {
    const matched = [...results].filter(([route]) => baselines.has(route));
    const delta = harness === baselineHarness ? 0 :
      matched.reduce((sum, [route, result]) => sum + result.score - baselines.get(route).score, 0) / models;
    harnesses.set(harness, { score: baselineMean + delta, delta, covered: matched.length,
      coverage: matched.length / models,
      models: matched.map(([route]) => route), total: models,
      version: harness === baselineHarness ? null : harnessVersions.get(harness),
      rows: matched.flatMap(([, result]) => result.rows) });
  }
  return { baselineHarness, baselineMean, models, baselines, harnesses };
}
