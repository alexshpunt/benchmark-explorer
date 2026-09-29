import { canonicalModelFamily, compareHarnessVersions, median } from "../core.mjs";
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

/**
 * Build the three summary rankings from complete accepted runs.
 *
 * Each model-family and harness-family pair first selects the newest harness
 * version available for that model. The pair receives the median run score;
 * model and harness scores are medians of those pair scores, so every pair has
 * one vote regardless of how often it was run.
 */
export function summaryLeaderboards(rows) {
  const complete = rows.filter((row) => row.fullBenchmark === true && Number.isFinite(row.score));
  const pairs = group(complete, (row) =>
    JSON.stringify([canonicalModelFamily(row.modelFamily), row.harnessFamily]));
  const combinations = [];
  for (const pairRows of pairs.values()) {
    const version = pairRows.map((row) => row.harnessVersion ?? "")
      .sort(compareHarnessVersions).at(-1);
    const sourceRows = pairRows.filter((row) => (row.harnessVersion ?? "") === version);
    const first = sourceRows[0];
    combinations.push({
      model: canonicalModelFamily(first.modelFamily),
      harness: first.harnessFamily,
      version: version || null,
      score: median(sourceRows.map((row) => row.score)),
      runs: runCount(sourceRows),
      sourceRows,
    });
  }
  ranked(combinations, (row) => `${row.model}\t${row.harness}`);

  const summarize = (key, peer) => [...group(combinations, key)].map(([name, items]) => {
    const sourceRows = items.flatMap((item) => item.sourceRows);
    return {
      name,
      score: median(items.map((item) => item.score)),
      combinations: new Set(items.map(peer)).size,
      runs: runCount(sourceRows),
      sourceRows,
    };
  });
  const models = summarize((item) => item.model, (item) => item.harness);
  const harnesses = summarize((item) => item.harness, (item) => item.model);
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

  return (rows) => {
    grids.forEach((grid) => grid.destroy());
    grids = [];
    const rankings = summaryLeaderboards(rows);
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
    select(document.querySelector("[data-summary-tab][aria-selected=\"true\"]")?.dataset.summaryTab ?? "models");
  };
}
