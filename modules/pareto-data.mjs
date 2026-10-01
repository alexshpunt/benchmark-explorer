import { combinationScore } from "./scoring.mjs";
import { compareHarnessVersions, median, modelReasoning } from "../core.mjs";

const modelOf = (cell) => cell.model.split("\t")[0];
const measured = (row, metric) => row[metric]?.observations === row.observations &&
  Number.isFinite(row[metric]?.total) && row[metric].total > 0;
const varyingSpan = (scores) => scores.length > 1 && Math.min(...scores) < Math.max(...scores)
  ? { low: Math.min(...scores), high: Math.max(...scores) } : null;

/** Plot only full model-route × harness × reasoning combinations with a measured X value. */
export function paretoPoints(cells, axis = "cost") {
  const metric = axis === "tokens" ? "tokens" : "cost";
  let missingAxis = 0;
  const points = cells.filter((cell) => cell.compact && !cell.grouped && !cell.overall)
    .flatMap((original) => {
      const full = (original.sourceRows ?? []).filter((row) =>
        row.fullBenchmark && Number.isFinite(row.score));
      if (!full.length) return [];
      const version = full.map((row) => row.harnessVersion ?? "")
        .sort(compareHarnessVersions).at(-1);
      const variants = new Map();
      for (const row of full.filter((entry) => (entry.harnessVersion ?? "") === version)) {
        const reasoning = modelReasoning(row);
        variants.set(reasoning, [...(variants.get(reasoning) ?? []), row]);
      }
      return [...variants].flatMap(([reasoning, selected]) => {
        const byRun = new Map();
        for (const row of selected) {
          // Rows without a run ID cannot prove they represent independent runs.
          const id = row.runId ?? "unknown";
          byRun.set(id, [...(byRun.get(id) ?? []), row]);
        }
        const runGroups = [...byRun.values()];
        const scores = runGroups.map(combinationScore);
        const value = selected.every((row) => measured(row, metric))
          ? median(runGroups.map((group) => median(group.map((row) => row[metric].total))))
          : null;
        if (value == null) { missingAxis++; return []; }
        const score = combinationScore(selected);
        const key = `pareto:route:${JSON.stringify([original.model, original.harness, version, reasoning])}`;
        const cell = { ...original, key, score, version, reasoning,
          label: `${original.harness}@${version} · ${reasoning}`,
          sourceRows: selected, compact: false, runId: null,
          observations: selected.reduce((count, row) => count + row.observations, 0) };
        const runRange = varyingSpan(scores);
        return [{ kind: "route", key, cell, version, reasoning,
          model: modelOf(cell), provider: cell.model.split("\t")[1], harness: cell.harness,
          score, xValue: value, runRange,
          low: runRange?.low ?? score, high: runRange?.high ?? score,
          runs: byRun.size, observations: cell.observations }];
      });
    });
  return { points, missingAxis };
}

/** Connect measured reasoning modes only within the same model route and harness version. */
export function paretoReasoningLinks(points) {
  const order = ["off", "low", "medium", "high", "xhigh"];
  const groups = new Map();
  for (const point of points) {
    if (point.kind !== "route" || point.reasoning === "unspecified") continue;
    const key = JSON.stringify([point.model, point.provider, point.harness, point.version]);
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  return [...groups.values()].filter((group) => group.length > 1)
    .map((group) => group.toSorted((left, right) =>
      (order.indexOf(left.reasoning) < 0 ? order.length : order.indexOf(left.reasoning)) -
      (order.indexOf(right.reasoning) < 0 ? order.length : order.indexOf(right.reasoning)) ||
      left.reasoning.localeCompare(right.reasoning)));
}

/** Non-dominated measured combinations: cheaper and at least as good wins. */
export function paretoFrontier(points) {
  const ordered = points.filter((p) => p.kind === "route")
    .sort((a, b) => a.xValue - b.xValue || b.score - a.score || a.key.localeCompare(b.key));
  let best = -Infinity;
  return ordered.filter((point) => {
    if (point.score <= best) return false;
    best = point.score;
    return true;
  });
}
