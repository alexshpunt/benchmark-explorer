import { compareHarnessVersions, median } from "../core.mjs";

const modelOf = (cell) => cell.model.split("\t")[0];
const priced = (row) => row.cost?.observations === row.observations &&
  Number.isFinite(row.cost.total) && row.cost.total > 0;
const span = (scores) => ({ low: Math.min(...scores), high: Math.max(...scores) });
const varyingSpan = (scores) => scores.length > 1 && Math.min(...scores) < Math.max(...scores)
  ? span(scores) : null;

/** Plot complete, fully priced combinations and summaries from compact matrix cells. */
export function paretoPoints(cells) {
  const routes = cells.filter((cell) => cell.compact && !cell.grouped && !cell.overall)
    .flatMap((original) => {
      const allRuns = (original.sourceRows ?? []).filter((row) => row.fullBenchmark && Number.isFinite(row.score));
      if (!allRuns.length) return [];
      const version = allRuns.map((row) => row.harnessVersion ?? "").sort(compareHarnessVersions).at(-1);
      const selected = allRuns.filter((row) => (row.harnessVersion ?? "") === version);
      const byRun = new Map();
      for (const row of selected) {
        // A row without an ID is not evidence that two rows are independent runs.
        const id = row.runId ?? "unknown";
        byRun.set(id, [...(byRun.get(id) ?? []), row]);
      }
      const runGroups = [...byRun.values()];
      const scores = runGroups.map((group) => median(group.map((row) => row.score)));
      const score = median(scores);
      const cost = selected.every(priced)
        ? median(runGroups.map((group) => median(group.map((row) => row.cost.total)))) : null;
      const key = `pareto:route:${JSON.stringify([original.model, original.harness, version])}`;
      const cell = { ...original, key, score, version, label: `${original.harness}@${version}`,
        sourceRows: selected, compact: false, runId: null,
        observations: selected.reduce((count, row) => count + row.observations, 0) };
      return [{ cell, allRuns, selected, version, score, cost, scores, runCount: byRun.size }];
    });
  const points = routes.filter(({ cost }) => cost != null)
    .map(({ cell, version, score, cost, scores, runCount }) => {
      const runRange = varyingSpan(scores);
      return { kind: "route", key: cell.key, cell, version, model: modelOf(cell),
        provider: cell.model.split("\t")[1], harness: cell.harness, score, cost, runRange,
        low: runRange?.low ?? score, high: runRange?.high ?? score,
        runs: runCount, observations: cell.observations };
    });
  const byAxis = (axis) => {
    const groups = new Map();
    for (const route of routes) {
      const name = axis === "model" ? modelOf(route.cell) : route.cell.harness;
      groups.set(name, [...(groups.get(name) ?? []), route]);
    }
    return [...groups].flatMap(([name, members]) => {
      const measured = members.filter(({ cost }) => cost != null);
      if (!measured.length) return [];
      // Model families share provider votes; harnesses share model-family votes.
      const votes = new Map();
      for (const member of members) {
        const vote = axis === "model" ? member.cell.model : modelOf(member.cell);
        votes.set(vote, [...(votes.get(vote) ?? []), member]);
      }
      const score = median([...votes.values()].map((group) => median(group.map((p) => p.score))));
      const costVotes = new Map();
      for (const member of measured) {
        const vote = axis === "model" ? member.cell.model : modelOf(member.cell);
        costVotes.set(vote, [...(costVotes.get(vote) ?? []), member.cost]);
      }
      const cost = median([...costVotes.values()].map(median));
      const sourceRows = [...new Set(members.flatMap((member) => member.selected))];
      const range = varyingSpan(members.flatMap((member) => member.allRuns.map((row) => row.score)));
      const key = `pareto:${axis}:${name}`;
      const cell = { key, model: axis === "model" ? name : "Across all models",
        harness: axis === "harness" ? name : "all", label: name, score, sourceRows,
        version: axis === "harness" ? "across models" : null, overall: axis === "model",
        observations: sourceRows.reduce((n, row) => n + row.observations, 0), compact: true };
      return [{ kind: axis, key, cell, model: axis === "model" ? name : null,
        harness: axis === "harness" ? name : null, score, cost, range,
        low: range?.low ?? score, high: range?.high ?? score,
        runs: new Set(sourceRows.map((row) => row.runId)).size,
        observations: cell.observations, routes: members.length, pricedRoutes: measured.length }];
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
