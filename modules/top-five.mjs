import { canonicalModelFamily, compareHarnessVersions, median } from "../core.mjs";

const byName = (a, b) => a.name.localeCompare(b.name);
const byScore = (a, b) => b.score - a.score || byName(a, b);
const byCost = (a, b) => a.cost - b.cost || byScore(a, b);

/** Build comparable family summaries from full runs, giving each route one vote. */
export function topFiveGroups(rows, acceptedRunIds) {
  const order = new Map(acceptedRunIds.map((id, index) => [id, index]));
  const routes = new Map();
  for (const row of rows) {
    if (row.fullBenchmark !== true || !Number.isFinite(row.score)) continue;
    const model = canonicalModelFamily(row.modelFamily);
    const key = JSON.stringify([model, row.provider ?? "unknown", row.harnessFamily]);
    const current = routes.get(key);
    const version = row.harnessVersion ?? "";
    const comparison = current ? compareHarnessVersions(version, current.version) : 1;
    const newer = (order.get(row.runId) ?? -1) > (order.get(current?.runId) ?? -1);
    if (!current || comparison > 0 || (comparison === 0 && newer)) {
      routes.set(key, { model, provider: row.provider ?? "unknown", harness: row.harnessFamily,
        version, runId: row.runId, rows: [row] });
    } else if (comparison === 0 && row.runId === current.runId) current.rows.push(row);
  }
  const selected = [...routes.values()].map(({ model, provider, harness, rows: sources }) => ({
    model, provider, harness,
    score: median(sources.map((row) => row.score)),
    cost: median(sources.filter((row) => row.cost?.observations === row.observations &&
      Number.isFinite(row.cost.total)).map((row) => row.cost.total)),
  }));
  const models = new Map();
  const harnesses = new Map();
  for (const route of selected) {
    models.set(route.model, [...(models.get(route.model) ?? []), route]);
    harnesses.set(route.harness, [...(harnesses.get(route.harness) ?? []), route]);
  }
  return {
    models: [...models].filter(([, items]) => items.length >= 3).map(([name, items]) => {
      const providers = new Map();
      for (const item of items)
        providers.set(item.provider, [...(providers.get(item.provider) ?? []), item]);
      return { name, routes: items.length,
        score: median([...providers.values()].map((group) => median(group.map((item) => item.score)))),
        cost: median([...providers.values()].map((group) => median(group.map((item) => item.cost)))),
      };
    }),
    harnesses: [...harnesses].filter(([, items]) => items.length >= 3).map(([name, items]) => ({
      name, routes: items.length, score: median(items.map((item) => item.score)),
      cost: median(items.map((item) => item.cost)),
    })),
  };
}

/** Sort eligible families by score, measured price, or equally weighted ranks. */
export function rankTopFive(groups, criterion) {
  if (criterion === "score") return [...groups].sort(byScore).slice(0, 5);
  const priced = groups.filter((group) => Number.isFinite(group.cost));
  if (criterion === "cost") return priced.sort(byCost).slice(0, 5);
  const scoreRanks = new Map([...priced].sort(byScore).map((group, index) => [group.name, index + 1]));
  const costRanks = new Map([...priced].sort(byCost).map((group, index) => [group.name, index + 1]));
  return priced.sort((a, b) =>
    scoreRanks.get(a.name) + costRanks.get(a.name) - scoreRanks.get(b.name) - costRanks.get(b.name) ||
    byScore(a, b)).slice(0, 5);
}

/** Draw the two clickable, identically sorted cards from the published snapshot. */
export function renderTopFive(groups, criterion, hrefFor) {
  for (const [kind, selector] of [["models", "#top-models"], ["harnesses", "#top-harnesses"]]) {
    const list = document.querySelector(selector);
    const winners = rankTopFive(groups[kind], criterion);
    list.replaceChildren();
    if (!winners.length) {
      const empty = document.createElement("li");
      empty.className = "top-five-empty";
      empty.textContent = "No entries with a measured full-run price yet.";
      list.append(empty);
    }
    for (const [index, item] of winners.entries()) {
      const entry = document.createElement("li");
      const link = document.createElement("a");
      link.href = hrefFor(kind, item.name);
      link.title = `Explore ${item.name} in the matrix and leaderboard`;
      link.style.setProperty("--rank-fill", `${100 - index * 10}%`);
      const place = document.createElement("span");
      place.className = "top-five-place";
      place.textContent = String(index + 1);
      const label = document.createElement("span");
      label.className = "top-five-name";
      const name = document.createElement("strong");
      name.textContent = item.name;
      const count = document.createElement("small");
      count.textContent = `${item.routes} routes`;
      label.append(name, count);
      const values = document.createElement("span");
      values.className = "top-five-values";
      const score = document.createElement("b");
      score.textContent = (item.score * 100).toFixed(1);
      score.title = "Median score";
      const price = document.createElement("span");
      price.textContent = item.cost == null ? "—" : `$${item.cost.toFixed(item.cost < 0.01 ? 3 : 2)}`;
      price.title = item.cost == null ? "No fully measured price" : "Median price for a full run";
      values.append(score, price);
      link.append(place, label, values);
      entry.append(link);
      list.append(entry);
    }
    if (winners.length > 0 && winners.length < 5 && criterion !== "score") {
      const note = document.createElement("li");
      note.className = "top-five-empty";
      note.textContent = `Only ${winners.length} eligible ${kind === "models" ? "models" : "harnesses"} have a fully measured price.`;
      list.append(note);
    }
  }
}