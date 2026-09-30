import { baselineHarnessScores, combinationScore, modelScore, scoredCombinations } from "./scoring.mjs";

import { renderDataTable } from "./leaderboard.mjs";
import { h } from "../vendor/gridjs-6.2.0.mjs";

const group = (items, key) => {
  const groups = new Map();
  for (const item of items) {
    const id = key(item);
    groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  return groups;
};

const runCount = (rows) => new Set(rows.map((row) => row.runId)).size;
const ranked = (rows, label) => rows.sort((left, right) =>
  right.score - left.score || label(left).localeCompare(label(right)));

/** Build rankings through the shared combination, model, and baseline scoring contract. */
export function summaryLeaderboards(rows, baselineRows = rows) {
  const combinations = [...group(scoredCombinations(rows), (item) => JSON.stringify([item.model, item.harness]))]
    .map(([_key, items]) => {
      const sourceRows = items.flatMap((item) => item.sourceRows);
      return { model: items[0].model, harness: items[0].harness,
        version: [...new Set(items.map((item) => item.version))].join(" / "),
        score: combinationScore(sourceRows), runs: runCount(sourceRows), sourceRows };
    });
  ranked(combinations, (row) => `${row.model}\t${row.harness}`);

  const summarize = (key, peer) => [...group(combinations, key)].map(([name, items]) => {
    const sourceRows = items.flatMap((item) => item.sourceRows);
    return {
      name,
      score: modelScore(items),
      combinations: new Set(items.map(peer)).size,
      runs: runCount(sourceRows),
      sourceRows,
    };
  });
  const models = summarize((item) => item.model, (item) => item.harness);
  const ratings = baselineHarnessScores(baselineRows);
  const visibleHarnesses = new Set(rows.map((row) => row.harnessFamily));
  const harnesses = [...ratings.harnesses].filter(([name]) => visibleHarnesses.has(name)).map(([name, rating]) => ({
    name, score: rating.score, delta: rating.delta, coverage: rating.coverage,
    combinations: rating.covered, runs: runCount(rating.rows), sourceRows: rating.rows,
  }));
  ranked(models, (row) => row.name);
  ranked(harnesses, (row) => row.name);
  return { models, harnesses, combinations };
}

const score = (value) => Number((value * 100).toFixed(1));

/** Render the tabbed model, harness and combination rankings. */
export function createSummaryLeaderboards(openConfigurationDetails) {
  let grids = [];
  const tables = {
    models: [
      { id: "#", name: "#", sort: false, cell: (_row, index) => index + 1 },
      { id: "model", name: "Model", cell: (row) => row.name },
      { id: "score", name: "Score", cell: (row) => score(row.score) },
      { id: "combinations", name: "Harnesses", cell: (row) => row.combinations },
      { id: "runs", name: "Runs", cell: (row) => row.runs },
    ],
    harnesses: [
      { id: "#", name: "#", sort: false, cell: (_row, index) => index + 1 },
      { id: "harness", name: "Harness", cell: (row) => row.name },
      { id: "score", name: "Score", cell: (row) => score(row.score) },
      { id: "combinations", name: "Models", cell: (row) => row.combinations },
      { id: "runs", name: "Runs", cell: (row) => row.runs },
    ],
    combinations: [
      { id: "#", name: "#", sort: false, cell: (_row, index) => index + 1 },
      { id: "model", name: "Model", cell: (row) => row.model },
      { id: "harness", name: "Harness", cell: (row) => row.harness },
      { id: "version", name: "Version", cell: (row) => row.version ?? "—" },
      { id: "score", name: "Score", cell: (row) => score(row.score) },
      { id: "runs", name: "Runs", cell: (row) => row.runs },
    ],
  };

  function select(name) {
    document.querySelectorAll("[data-summary-tab]").forEach((button) => {
      const active = button.dataset.summaryTab === name;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll("[data-summary-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.summaryPanel !== name;
    });
  }

  document.querySelectorAll("[data-summary-tab]").forEach((button) => {
    button.addEventListener("click", () => select(button.dataset.summaryTab));
  });

  return (rows, baselineRows = rows) => {
    grids.forEach((grid) => grid.destroy());
    grids = [];
    const rankings = summaryLeaderboards(rows, baselineRows);
    for (const [name, columns] of Object.entries(tables)) {
      const host = document.querySelector(`[data-summary-grid="${name}"]`);
      host.replaceChildren();
      grids.push(renderDataTable(host, rankings[name], columns, {
        className: "results-table summary-results-table",
        onCell: ({ cell, row }) => h("button", {
          type: "button",
          className: "cell-detail",
          title: "Open the full evidence behind this ranking",
          onClick: () => openConfigurationDetails(row.sourceRows),
        }, String(cell)),
      }));
    }
    select(document.querySelector("[data-summary-tab][aria-selected=\"true\"]")?.dataset.summaryTab ?? "combinations");
  };
}
