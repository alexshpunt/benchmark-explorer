import { median } from "../core.mjs";

const modelOf = (cell) => cell.model.split("\t")[0];
const priced = (row) => row.cost?.observations === row.observations &&
  Number.isFinite(row.cost.total) && row.cost.total > 0;
const span = (scores) => ({ low: Math.min(...scores), high: Math.max(...scores) });

/** Plot full, fully priced model-route × harness cells and their independent summaries. */
export function paretoPoints(cells) {
  const routes = cells.filter((cell) => cell.compact && !cell.grouped && !cell.overall)
    .map((cell) => {
      const runs = (cell.sourceRows ?? []).filter((row) => row.fullBenchmark && Number.isFinite(row.score));
      return { cell, runs, cost: runs.length && runs.every(priced)
        ? median(runs.map((row) => row.cost.total)) : null };
    }).filter(({ runs }) => runs.length);
  const ranges = (keyOf) => {
    const groups = new Map();
    for (const { cell } of routes) {
      if (!Number.isFinite(cell.score)) continue;
      const key = keyOf(cell);
      groups.set(key, [...(groups.get(key) ?? []), cell.score]);
    }
    return new Map([...groups].map(([key, scores]) => [key, span(scores)]));
  };
  const models = ranges((cell) => cell.model);
  const harnesses = ranges((cell) => cell.harness);
  const points = routes.filter(({ cell, cost }) => Number.isFinite(cell.score) && cost != null)
    .map(({ cell, runs, cost }) => {
      const modelRange = models.get(cell.model);
      const harnessRange = harnesses.get(cell.harness);
      return { kind: "route", key: cell.key, cell, model: modelOf(cell), provider: cell.model.split("\t")[1],
        harness: cell.harness, score: cell.score, cost, modelRange, harnessRange,
        low: Math.min(modelRange.low, harnessRange.low), high: Math.max(modelRange.high, harnessRange.high),
        runs: new Set(runs.map((row) => row.runId)).size,
        observations: runs.reduce((n, row) => n + row.observations, 0) };
    });
  const byAxis = (axis) => {
    const groups = new Map();
    for (const route of routes) {
      const name = axis === "model" ? modelOf(route.cell) : route.cell.harness;
      groups.set(name, [...(groups.get(name) ?? []), route]);
    }
    return [...groups].flatMap(([name, members]) => {
      if (members.some(({ cell, cost }) => cost == null || !Number.isFinite(cell.score))) return [];
      // Model families share provider votes; harnesses share model-family votes.
      const votes = new Map();
      for (const member of members) {
        const vote = axis === "model" ? member.cell.model : modelOf(member.cell);
        votes.set(vote, [...(votes.get(vote) ?? []), member]);
      }
      const score = median([...votes.values()].map((group) => median(group.map((p) => p.cell.score))));
      const cost = median([...votes.values()].map((group) => median(group.map((p) => p.cost))));
      const runs = [...new Set(members.flatMap((p) => p.runs))];
      const sourceRows = [...new Set(runs)];
      const key = `pareto:${axis}:${name}`;
      const cell = { key, model: axis === "model" ? name : "Across all models",
        harness: axis === "harness" ? name : "all", label: name, score, sourceRows,
        version: axis === "harness" ? "across models" : null, overall: axis === "model",
        observations: sourceRows.reduce((n, row) => n + row.observations, 0), compact: true };
      return [{ kind: axis, key, cell, model: axis === "model" ? name : null,
        harness: axis === "harness" ? name : null, score, cost,
        ...span(members.map((p) => p.cell.score)),
        runs: new Set(sourceRows.map((row) => row.runId)).size,
        observations: cell.observations, routes: members.length }];
    });
  };
  return { points: [...points, ...byAxis("model"), ...byAxis("harness")],
    unpriced: routes.filter(({ cost }) => cost == null).length };
}

/** Non-dominated measured combinations: cheaper and at least as good wins. */
export function paretoFrontier(points) {
  const ordered = points.filter((p) => p.kind === "route")
    .sort((a, b) => a.cost - b.cost || b.score - a.score || a.key.localeCompare(b.key));
  let best = -Infinity;
  return ordered.filter((point) => {
    if (point.score <= best) return false;
    best = point.score;
    return true;
  });
}
