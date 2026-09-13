import { Grid } from "./vendor/gridjs-6.2.0.mjs";

const DATASET_PAGE = "https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark";
const DATASET_ROOT = `${DATASET_PAGE}/resolve/main/`;
const state = { rows: [], visible: [] };
const status = document.querySelector("#load-status");

const percent = (value) => (value == null ? "—" : (value * 100).toFixed(value === 1 ? 0 : 1));
const average = (metric) =>
  metric?.observations ? metric.total / metric.observations : null;
const value = (row, key) => String(row[key] ?? "");

function renderMatrix(rows) {
  const models = [...new Set(rows.map((row) => row.modelFamily))];
  const harnesses = [...new Set(rows.map((row) => row.harnessFamily))];
  const table = document.createElement("table");
  table.className = "matrix-table";
  table.innerHTML = `<thead><tr><th>Model × harness</th>${harnesses
    .map((name) => `<th>${name}</th>`)
    .join("")}</tr></thead><tbody>${models
    .map(
      (model) => `<tr><th>${model}</th>${harnesses
        .map((harness) => {
          const match = rows.find(
            (row) => row.modelFamily === model && row.harnessFamily === harness,
          );
          return `<td>${match ? percent(match.score) : "—"}</td>`;
        })
        .join("")}</tr>`,
    )
    .join("")}</tbody>`;
  const target = document.querySelector("#matrix-view");
  target.replaceChildren(table);
  const scores = rows.map((row) => row.score).filter(Number.isFinite);
  document.querySelector("#matrix-scale-min").textContent = percent(Math.min(...scores));
  document.querySelector("#matrix-scale-max").textContent = percent(Math.max(...scores));
}

function renderTable(rows) {
  const target = document.querySelector("#results-grid");
  target.replaceChildren();
  new Grid({
    columns: [
      { name: "#", data: (row) => row._index + 1 },
      { name: "Score", data: (row) => percent(row.score) },
      { name: "Trials", data: (row) => row.observations },
      { name: "Model", data: (row) => row.modelFamily },
      { name: "Agent", data: (row) => row.agentFamily },
      { name: "Harness", data: (row) => row.harnessFamily },
      { name: "Harness version", data: (row) => row.harnessVersion },
      { name: "Thinking", data: (row) => row.thinking },
      { name: "Coverage", data: (row) => `${row.taskCount}/${row.benchmarkTaskCount} (${percent(row.coverage)}%)` },
      { name: "First exact (%)", data: (row) => percent(row.firstExactRate) },
      { name: "Final exact (%)", data: (row) => percent(row.finalExactRate) },
      { name: "Avg seconds", data: (row) => average(row.duration)?.toFixed(2) ?? "—" },
    ],
    data: rows,
    sort: true,
    search: true,
    pagination: { limit: 50 },
  }).render(target);
}

function render() {
  const query = document.querySelector("#explorer-search")?.value.trim().toLowerCase() ?? "";
  state.visible = state.rows.filter((row) =>
    !query || [row.modelFamily, row.agentFamily, row.harnessFamily, row.harnessVersion, row.thinking]
      .some((item) => value({ item }, "item").toLowerCase().includes(query)),
  );
  renderMatrix(state.visible);
  renderTable(state.visible);
  document.querySelector("#summary-context").textContent = `${state.visible.length} accepted configurations. Scores are precomputed by the dataset acceptance pipeline.`;
}

async function load() {
  try {
    const [leaderboardResponse, indexResponse] = await Promise.all([
      fetch(`${DATASET_ROOT}leaderboard.json`, { cache: "no-store" }),
      fetch(`${DATASET_ROOT}dataset-index.json`, { cache: "no-store" }),
    ]);
    if (!leaderboardResponse.ok || !indexResponse.ok) throw Error("The public dataset could not be loaded");
    const [leaderboard, index] = await Promise.all([
      leaderboardResponse.json(),
      indexResponse.json(),
    ]);
    if (leaderboard.schemaVersion !== 1 || !Array.isArray(leaderboard.official)) {
      throw Error("Unsupported leaderboard contract");
    }
    state.rows = leaderboard.official.map((row, index) => ({ ...row, _index: index }));
    const observations = state.rows.reduce((sum, row) => sum + row.observations, 0);
    status.dataset.kind = "ready";
    status.textContent = "Loaded trusted precomputed results";
    document.querySelector("#revision").textContent = index.datasetCommit?.slice(0, 8) ?? "main";
    document.querySelector("#freshness").textContent = new Date().toLocaleString();
    document.querySelector("#observation-total").textContent = observations.toLocaleString();
    document.querySelector("#loader").hidden = true;
    render();
  } catch (error) {
    status.dataset.kind = "error";
    status.textContent = error.message;
    document.querySelector("#error-help").hidden = false;
    document.querySelector("#loader").hidden = true;
  }
}

document.querySelector("#reset-filters").addEventListener("click", () => {
  const search = document.querySelector("#explorer-search");
  if (search) search.value = "";
  render();
});

const toolbar = document.querySelector(".view-actions");
const search = document.createElement("input");
search.id = "explorer-search";
search.type = "search";
search.placeholder = "Filter model, agent, harness…";
search.setAttribute("aria-label", "Filter leaderboard");
search.addEventListener("input", render);
toolbar.prepend(search);
document.querySelector("#selection-panel").remove();
document.querySelector("#filter-all").remove();
document.querySelector("#range-filter-form").remove();
document.querySelector("#cell-details").remove();
load();
