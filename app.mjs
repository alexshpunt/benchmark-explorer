import {
  aggregateGroupScore,
  aggregateLeaderboard,
  aggregateToolUsage,
  canonicalModelFamily,
  describeDistribution,
  explorerSearch,
  parseExplorerControls,
  parseExplorerState,
  parseJsonLines,
  popoverPosition,
  precomputedFamilyScore,
  taskFamily,
  toolTrialCounts,
  setViewsData,
} from "./core.mjs";
import { Grid, h } from "./vendor/gridjs-6.2.0.mjs";

/** Public home of the accepted data, and the base for every provenance link. */
const DATASET_PAGE = "https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark";
/** Raw file base, used to fetch the data shards. */
const DATASET_ROOT = `${DATASET_PAGE}/resolve/main/`;
/**
 * Score scale stops, worst first. Worst reads red, best reads green with an
 * amber midpoint, so the colour carries the same judgement a reader expects.
 * renderMatrix uses these stops for both the per-cell bar and the legend.
 */
const SCORE_RAMP = [
  { hue: 27.3, lightness: 57.7, chroma: 0.245 },
  { hue: 84.4, lightness: 82.8, chroma: 0.189 },
  { hue: 163.2, lightness: 59.6, chroma: 0.145 },
];

/** Colour for a place on the score scale, where 0 is worst and 1 is best. */
function scoreColor(position) {
  const scaled = Math.min(1, Math.max(0, position)) * (SCORE_RAMP.length - 1);
  const index = Math.floor(scaled);
  const lower = SCORE_RAMP[index];
  const upper = SCORE_RAMP[Math.min(SCORE_RAMP.length - 1, index + 1)];
  const mix = scaled - index;
  const at = (key) => lower[key] + (upper[key] - lower[key]) * mix;
  return `oklch(${at("lightness").toFixed(1)}% ${at("chroma").toFixed(3)} ${at("hue").toFixed(1)})`;
}

const SCORE_RAMP_GRADIENT = `linear-gradient(90deg, ${SCORE_RAMP.map((_stop, index) =>
  scoreColor(index / (SCORE_RAMP.length - 1)),
).join(", ")})`;

/**
 * Ramp bounds from the visible scores, taken at the 5th and 95th percentile.
 * A single failed run scoring near zero would otherwise stretch the scale over
 * the whole 0-100 range and flatten every real difference into one green.
 */
function rampBounds(scores) {
  const sorted = [...scores].sort((left, right) => left - right);
  const at = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))];
  const low = at(0.05);
  const high = at(0.95);
  return low < high ? { low, high } : { low: sorted[0], high: sorted[sorted.length - 1] };
}

/** Comparison series colours, resolved per theme by styles.css. */
const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];const FILTER_LABELS = {
  model: "Model",
  agent: "Agent",
  harness: "Harness",
  harnessVersion: "Harness version",
  reasoning: "Thinking",
  benchmark: "Benchmark",
  taskFamily: "Task family",
};
const initialControls = parseExplorerControls(location.search);
const initialRoute = parseExplorerState(location.search);
const initialParams = new URLSearchParams(location.search);
const state = {
  index: null,
  profiles: [],
  trials: [],
  rounds: [],
  toolCalls: [],
  filters: new Map(
    Object.entries({
      ...initialControls.filters,
      ...filtersFromRoute(initialRoute),
    }).map(([name, values]) => [name, new Set(values)]),
  ),
  selected: new Set(initialParams.getAll("select")),
  /** Visible leaderboard rows, best score first. @type {(Record<string, any> | undefined)[]} */
  rows: [],
  /** Configurations visible under the filters, before table-only range filters. */
  configurations: [],
  /** Every visible configuration, used for filter counts and menus. */
  allRows: [],
  /** Numeric range filters. They narrow the table only, not the whole page. */
  rangeFilters: new Map(),
  /** Column whose range popover is currently open. @type {string | null} */
  rangeColumn: null,
  filterCategory: /** @type {string | null} */ (null),
  /** Card currently open in the dialog, mirrored into the URL. @type {string | null} */
  card: null,
};
const status = document.querySelector("#load-status");

function setStatus(kind, text) {
  status.dataset.kind = kind;
  status.textContent = text;
}

/**
 * Move the loading screen forward. The headline stays human; the shard count
 * is useful detail, so it lives on the smaller line below the bar.
 */
function setLoader(headline, progress, detail) {
  document.querySelector("#loader-text").textContent = headline;
  document.querySelector(".loader-bar").setAttribute("aria-valuenow", String(Math.round(progress)));
  document.querySelector("#loader-progress").style.width = `${Math.max(2, progress)}%`;
  if (detail) document.querySelector("#loader-detail").textContent = detail;
}

function hideLoader() {
  document.querySelector("#loader").hidden = true;
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function fetchGzipJsonLines(file, label, progress) {
  const response = await fetch(new URL(file.path, DATASET_ROOT), { cache: "no-store" });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const compressed = await response.arrayBuffer();
  const actualHash = await sha256(compressed);
  if (file.sha256 && actualHash !== file.sha256) {
    throw new Error(`${label}: downloaded shard did not match its published checksum`);
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  progress();
  return parseJsonLines(await new Response(stream).text());
}

function filtersFromRoute(route) {
  return Object.fromEntries(
    ["model", "reasoning", "agent", "harness", "benchmark"].flatMap((key) =>
      route[key] ? [[key, [route[key]]]] : [],
    ),
  );
}

function selectedValues(name) {
  if (!state.filters.has(name)) state.filters.set(name, new Set());
  return state.filters.get(name);
}

function activeFilters() {
  return Object.fromEntries([...state.filters].map(([name, values]) => [name, [...values]]));
}

function currentSearch() {
  const search = explorerSearch(
    {},
    {
      comparison: "all",
      groupBy: ["model"],
      reference: null,
      sortBy: "score",
      sortDirection: "desc",
      filters: Object.fromEntries(
        [...state.filters]
          .filter(([, values]) => values.size > 0)
          .map(([name, values]) => [name, [...values]]),
      ),
    },
  );
  const params = new URLSearchParams(search);
  for (const selection of state.selected) params.append("select", selection);
  if (state.card) params.set("card", state.card);
  const theme = new URLSearchParams(location.search).get("__theme");
  if (theme) params.set("__theme", theme);
  return params.size ? `?${params.toString()}` : "";
}

let restoringCard = false;

/**
 * Keep the open card in the URL, so the browser Back button walks the
 * drill-down path instead of leaving the explorer.
 */
function setCard(value, push = true) {
  const previous = state.card;
  state.card = value;
  if (restoringCard) return;
  if (value) syncUrl(push);
  else if (previous) syncUrl(false);
}

/** Stable identity of one configuration, used in card URLs. */
function configToken(row) {
  return [
    canonicalModelFamily(row.modelFamily),
    row.harnessFamily,
    row.harnessVersion ?? "",
    row.thinking ?? "",
  ].join("|");
}

/** Harness value of a cell that covers every harness of its model. */
const OVERALL = "all";

/** Rows behind a card scope: "all", one configuration, or every harness. */
function scopeOf(token) {
  if (!token || token === "all") return state.configurations;
  const [model, harness, version = "", thinking = ""] = token.split("|");
  return state.configurations.filter(
    (row) =>
      canonicalModelFamily(row.modelFamily) === model &&
      (harness === "*" || row.harnessFamily === harness) &&
      (version === "" || (row.harnessVersion ?? "") === version) &&
      (thinking === "" || (row.thinking ?? "") === thinking),
  );
}

/**
 * Scope token for a card opened from a set of rows. One row keeps its exact
 * identity; a whole matrix cell drops the reasoning mode, which is the axis
 * that was rolled up.
 */
function scopeToken(rows) {
  const [first] = rows;
  if (!first) return "all";
  if (rows.length === 1) return configToken(first);
  // Rows that span several harnesses describe a whole model, not one cell.
  const harness =
    new Set(rows.map((row) => row.harnessFamily)).size > 1 ? "*" : first.harnessFamily;
  return [canonicalModelFamily(first.modelFamily), harness, first.harnessVersion ?? "", ""].join(
    "|",
  );
}

/** Reopen whatever card a URL points at. An empty value closes the dialog. */
function openCard(value) {
  const dialog = document.querySelector("#cell-details");
  const separator = value?.indexOf(":") ?? -1;
  if (!value || separator < 0) {
    dialog.close();
    return;
  }
  const kind = value.slice(0, separator);
  const payload = value.slice(separator + 1);
  if (kind === "config") {
    openConfigurationDetails(scopeOf(payload));
    return;
  }
  if (kind === "metric") {
    const [columnId, token] = payload.split("|");
    const [row] = scopeOf(token);
    const index = row ? state.rows.indexOf(row) : -1;
    if (row && index >= 0) openCellDetails(row, index, columnId);
    else dialog.close();
    return;
  }
  const [name, scope = "all"] = payload.split("|");
  if (kind === "model") openModelDetails(name);
  else if (kind === "harness") {
    const [family, version = ""] = name.split("@");
    openHarnessDetails(family, version || null);
  } else if (kind === "family") openTaskFamilyDetails(name, scopeOf(scope));
  else if (kind === "task") openTaskDetails(name, scopeOf(scope));
  else if (kind === "tool") openToolDetails(name, scopeOf(scope), scope !== "all");
  else dialog.close();
}

function syncUrl(push = false) {
  const search = currentSearch();
  history[push ? "pushState" : "replaceState"](null, "", search || location.pathname);
  window.parent.postMessage({ queryString: search }, "https://huggingface.co");
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function cellKey(model, harness, version) {
  return JSON.stringify([model, harness, version ?? null]);
}

function matrixCells(configurationRows) {
  const groups = new Map();
  const byModel = new Map();
  for (const row of configurationRows) {
    const model = canonicalModelFamily(row.modelFamily);
    const key = cellKey(model, row.harnessFamily, row.harnessVersion);
    groups.set(key, [...(groups.get(key) ?? []), row]);
    byModel.set(model, [...(byModel.get(model) ?? []), row]);
  }
  // The overall cell of a model pools its trials task by task, exactly like the
  // group score a model card reports.
  const overall = [...byModel].map(([model, rows]) => {
    const group = aggregateGroupScore(rows);
    return {
      key: cellKey(model, OVERALL, null),
      model,
      harness: OVERALL,
      version: null,
      overall: true,
      label: "Overall",
      score: group.score,
      firstExactRate: group.firstExactRate,
      finalExactRate: group.finalExactRate,
      recoveryGain: null,
      duration: mean(rows.map((row) => row.durationSummary.averageCase)),
      observations: rows.reduce((sum, row) => sum + row.observations, 0),
    };
  });
  return [
    ...overall,
    ...[...groups].map(([key, rows]) => {
      const [model, harness, version] = JSON.parse(key);
      return {
        key,
        model,
        harness,
        version,
        label: `${harness}@${version ?? "unknown"}`,
        score: mean(rows.map((row) => row.score)),
        firstExactRate: mean(rows.map((row) => row.firstExactRate)),
        finalExactRate: mean(rows.map((row) => row.finalExactRate)),
        recoveryGain: mean(rows.map((row) => row.recoveryGain)),
        duration: mean(
          rows.map((row) => row.durationSummary.averageCase).filter((value) => value != null),
        ),
        observations: rows.reduce((sum, row) => sum + row.observations, 0),
      };
    }),
  ];
}

/** Filter-visible rows behind one matrix cell. */
function rowsForCell(cell) {
  return state.configurations.filter(
    (row) =>
      canonicalModelFamily(row.modelFamily) === cell.model &&
      (cell.overall || (row.harnessFamily === cell.harness && row.harnessVersion === cell.version)),
  );
}

/** Tool-usage key for one configuration row, matching the aggregation key. */
function cellKeyFromRow(row) {
  return cellKey(canonicalModelFamily(row.modelFamily), row.harnessFamily, row.harnessVersion);
}

function toggleSelection(key) {
  if (state.selected.has(key)) state.selected.delete(key);
  else {
    if (state.selected.size === 4) state.selected.delete(state.selected.values().next().value);
    state.selected.add(key);
  }
  render();
  syncUrl(true);
}

function toggleOnlyFilter(name, value) {
  const values = selectedValues(name);
  const alreadyExclusive = values.size === 1 && values.has(value);
  values.clear();
  if (!alreadyExclusive) values.add(value);
  state.selected.clear();
  render();
  syncUrl();
}

function matrixFilterButton(name, value, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "matrix-quick-filter";
  const active = selectedValues(name).size === 1 && selectedValues(name).has(value);
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", (active ? "Clear " : "Filter to ") + label);
  button.title = (active ? "Clear " : "Filter to ") + label;
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 6h16M7 12h10M10 18h4");
  icon.append(path);
  button.append(icon);
  button.addEventListener("click", () => toggleOnlyFilter(name, value));
  return button;
}

function renderMatrix(cells) {
  const root = document.querySelector("#matrix-view");
  root.replaceChildren();
  const overallScore = new Map(
    cells.filter((cell) => cell.overall).map((cell) => [cell.model, cell.score ?? 0]),
  );
  const models = [...new Set(cells.map((cell) => cell.model))].sort(
    (left, right) =>
      (overallScore.get(right) ?? 0) - (overallScore.get(left) ?? 0) || left.localeCompare(right),
  );
  const overall = cells.find((cell) => cell.overall);
  const harnesses = [
    ...new Map(cells.filter((cell) => !cell.overall).map((cell) => [cell.label, cell])).values(),
  ].sort((left, right) => left.label.localeCompare(right.label));
  const series = overall ? [overall, ...harnesses] : harnesses;
  const byPosition = new Map(cells.map((cell) => [`${cell.model}\0${cell.label}`, cell]));
  for (const selected of [...state.selected]) {
    if (!cells.some((cell) => cell.key === selected)) state.selected.delete(selected);
  }
  // Selected cells take the colour of their series, in selection order, so a
  // cell and the chip that stands for it read as one thing.
  const selectionOrder = new Map([...state.selected].map((key, index) => [key, index]));
  // The ramp spans the visible scores, so the bars show relative standing.
  const { low, high } = rampBounds(cells.map((cell) => cell.score * 100));
  const span = high - low;
  const table = document.createElement("table");
  table.className = "matrix-table";
  table.style.minWidth = `${10 + series.length * 8}rem`;
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const modelHead = document.createElement("th");
  modelHead.className = "matrix-model-column";
  headRow.append(modelHead);
  for (const seriesCell of series) {
    const th = document.createElement("th");
    th.scope = "col";
    if (seriesCell.overall) {
      // One column for every harness of a model, so it is not a harness itself
      // and has no single harness card to open.
      th.className = "matrix-overall-head";
      th.textContent = seriesCell.label;
      th.title = "Every visible harness of this model, pooled per task";
      headRow.append(th);
      continue;
    }
    const duplicateHarness =
      series.filter((cell) => cell.harness === seriesCell.harness).length > 1;
    th.title = seriesCell.label;
    const columnButton = document.createElement("button");
    columnButton.type = "button";
    columnButton.className = "matrix-header";
    const columnLabel = document.createElement("span");
    columnLabel.className = "matrix-header-label";
    columnLabel.textContent = duplicateHarness
      ? `${seriesCell.harness} ${seriesCell.version}`
      : seriesCell.harness;
    columnButton.append(columnLabel);
    columnButton.title = `Open ${seriesCell.label}`;
    columnButton.addEventListener("click", () =>
      openHarnessDetails(seriesCell.harness, seriesCell.version),
    );
    th.append(columnButton);
    const filterName = seriesCell.version ? "harnessVersion" : "harness";
    const filterValue = seriesCell.version
      ? seriesCell.harness + "\t" + seriesCell.version
      : seriesCell.harness;
    th.append(matrixFilterButton(filterName, filterValue, seriesCell.label));
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const model of models) {
    const row = document.createElement("tr");
    const heading = document.createElement("th");
    heading.className = "matrix-model-column";
    heading.scope = "row";
    heading.title = `Open ${model}`;
    const rowButton = document.createElement("button");
    rowButton.type = "button";
    rowButton.className = "matrix-header";
    const rowLabel = document.createElement("span");
    rowLabel.className = "matrix-header-label";
    rowLabel.textContent = model;
    rowButton.append(rowLabel);
    rowButton.addEventListener("click", () => openModelDetails(model));
    heading.append(rowButton);
    heading.append(matrixFilterButton("model", model, model));
    row.append(heading);
    for (const seriesCell of series) {
      const td = document.createElement("td");
      const cell = byPosition.get(`${model}\0${seriesCell.label}`);
      if (cell) {
        const button = document.createElement("button");
        button.className = "matrix-cell";
        // The cell carries the frame colour, so the number and the bar stay clean.
        const position = selectionOrder.get(cell.key);
        const chosen = position != null;
        td.classList.toggle("selected", chosen);
        if (chosen) {
          td.style.setProperty("--selection-color", COLORS[position % COLORS.length]);
        }
        const score = cell.score * 100;
        button.style.setProperty("--score-color", scoreColor(span ? (score - low) / span : 1));
        button.textContent = score.toFixed(1);
        button.title = `${model}\n${cell.label}\n${cell.observations} observations\n${chosen ? "Selected — click to remove" : "Click to compare"}`;
        button.addEventListener("click", () => toggleSelection(cell.key));
        td.append(button);
      } else {
        td.className = "matrix-missing";
        td.textContent = "—";
      }
      row.append(td);
    }
    body.append(row);
  }
  table.append(head, body);
  root.append(table);
  const updateScrollEdges = () => {
    root.classList.toggle("can-scroll-left", root.scrollLeft > 1);
    root.classList.toggle(
      "can-scroll-right",
      root.scrollLeft + root.clientWidth < root.scrollWidth - 1,
    );
  };
  root.onscroll = updateScrollEdges;
  requestAnimationFrame(updateScrollEdges);
  const min = document.querySelector("#matrix-scale-min");
  const max = document.querySelector("#matrix-scale-max");
  min.textContent = low.toFixed(1);
  max.textContent = high.toFixed(1);
  min.title = "Worst visible score on the scale";
  max.title = "Best visible score on the scale";
  const ramp = document.querySelector(".matrix-legend-ramp");
  ramp.style.background = SCORE_RAMP_GRADIENT;
  ramp.title = `Scale runs from ${low.toFixed(1)} (worst) to ${high.toFixed(1)} (best)`;
}

let resultsGrid;

/** Percentage text with one decimal place, e.g. 0.9967 becomes "99.7%". */
function percentText(value) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** Mean rate per benchmark task, so a table-level rate shows its real spread. */
function perTaskRates(samples, pick) {
  const byTask = new Map();
  for (const sample of samples) {
    const values = byTask.get(sample.taskId) ?? [];
    values.push(pick(sample));
    byTask.set(sample.taskId, values);
  }
  return [...byTask.values()].map((values) => mean(values));
}

function observedAverage(metric) {
  return (row) => (row[metric].observations ? row[metric].total / row[metric].observations : null);
}

/**
 * Every leaderboard column: how it renders, what a cell click explains, and
 * which filter it maps to. `range` marks the columns that accept a numeric
 * range filter, and `detail` carries the explanation shown in the dialog.
 */
const COLUMNS = [
  {
    id: "#",
    name: "#",
    tooltip: "Rank among the currently visible configurations, best score first.",
    sort: false,
    cell: (row, index) => index + 1,
    detail: {
      lines: [
        "Rank is positional: configurations are ordered by Score, best first, and rank reflects only the rows currently visible after filtering.",
      ],
      inputs: (row, index) => [
        ["Rank", String(index + 1)],
        ["Visible configurations", String(state.rows.length)],
      ],
    },
  },
  {
    id: "score",
    name: "Score",
    tooltip: "Coverage × (75% first exact rate + 25% final exact rate). Higher is better.",
    cell: (row) => Number((row.score * 100).toFixed(3)),
    range: { value: (row) => row.score * 100, decimals: 3, unit: "" },
    detail: {
      lines: [
        "Score = coverage × (0.75 × first exact rate + 0.25 × final exact rate).",
        "The quality part rewards solving a task on the first attempt more than recovering later. The result is then scaled by how much of the benchmark was observed.",
      ],
      inputs: (row) => [
        ["Coverage", percentText(row.coverage)],
        ["Quality score", percentText(row.qualityScore)],
        ["First exact rate", percentText(row.firstExactRate)],
        ["Final exact rate", percentText(row.finalExactRate)],
        ["Observed tasks", row.taskCount.toLocaleString()],
      ],
    },
  },
  {
    id: "trials",
    name: "Trials",
    tooltip: "Benchmark task executions included in this configuration.",
    cell: (row) => row.observations,
    range: { value: (row) => row.observations, decimals: 0, unit: "" },
    detail: {
      lines: [
        "A trial is one execution of one benchmark task. Repeating the same task in another accepted run adds another trial, while coverage still counts the task once.",
      ],
      inputs: (row) => [
        ["Trials", row.observations.toLocaleString()],
        ["Unique tasks", row.taskCount.toLocaleString()],
        ["Recovery rounds", row.recoveryRounds.toLocaleString()],
        ["Accepted submissions", row.submissionIds.length.toLocaleString()],
      ],
    },
  },
  {
    id: "model",
    name: "Model",
    tooltip: "Model family. Select a name to inspect its statistics and sources.",
    cell: (row) => canonicalModelFamily(row.modelFamily),
    open: (row) => openModelDetails(canonicalModelFamily(row.modelFamily)),
    detail: {
      lines: [
        "Every accepted configuration recorded for this model under the current filters, and how its Score is built from the observed tasks.",
      ],
      inputs: (row) => [
        ["Provider", row.provider ?? "—"],
        ["Model version", row.modelVersion ?? "—"],
      ],
      identity: (row) => canonicalModelFamily(row.modelFamily),
      filter: { name: "model", value: (row) => canonicalModelFamily(row.modelFamily) },
    },
  },
  {
    id: "agent",
    name: "Agent",
    tooltip: "Agent or CLI that drove the model. Select a name to inspect its statistics.",
    cell: (row) => row.agentFamily,
    detail: {
      lines: [
        "The agent is the client that talked to the model. Comparing agents separates model quality from prompt and control-loop design.",
      ],
      inputs: (row) => [["Agent version", row.agentVersion ?? "—"]],
      identity: (row) => row.agentFamily,
      filter: { name: "agent", value: (row) => row.agentFamily },
    },
  },
  {
    id: "harness",
    name: "Harness",
    tooltip: "Tool environment exposed to the agent. Select a name to inspect its statistics.",
    cell: (row) => row.harnessFamily,
    open: (row) => openHarnessDetails(row.harnessFamily, null),
    detail: {
      lines: [
        "The harness defines which tools exist and how they are described. It is the main driver of how an agent reads and edits files.",
      ],
      inputs: (row) => [
        ["Harness family", row.harnessFamily],
        ["Harness version", row.harnessVersion ?? "—"],
      ],
      identity: (row) => row.harnessFamily,
      filter: { name: "harness", value: (row) => row.harnessFamily },
    },
  },
  {
    id: "harnessVersion",
    name: "Harness version",
    tooltip: "Published harness version used by this configuration.",
    cell: (row) => row.harnessVersion ?? "—",
    open: (row) => openHarnessDetails(row.harnessFamily, row.harnessVersion),
    detail: {
      lines: [
        "Harness versions are published identities. Two versions of one harness are different configurations and are scored separately.",
      ],
      inputs: (row) => [["Harness version", row.harnessVersion ?? "—"]],
      identity: (row) => `${row.harnessFamily}\t${row.harnessVersion}`,
      filter: {
        name: "harnessVersion",
        value: (row) => `${row.harnessFamily}\t${row.harnessVersion}`,
      },
    },
  },
  {
    id: "thinking",
    name: "Thinking",
    tooltip: "Reasoning level requested from the model.",
    cell: (row) => row.thinking ?? "—",
    detail: {
      lines: [
        "The reasoning level requested from the model. When reasoning is not fixed by a filter, accepted modes are rolled into one configuration.",
      ],
      inputs: (row) => [
        ["Thinking", row.thinking ?? "—"],
        ["Reasoning modes", String(row.reasoningModeCount ?? 1)],
      ],
      identity: (row) => row.thinking ?? "—",
      filter: { name: "reasoning", value: (row) => row.thinking },
    },
  },
  {
    id: "coverage",
    name: "Coverage",
    tooltip: "Unique benchmark tasks observed out of the visible benchmark total.",
    cell: (row) =>
      `${row.taskCount}/${row.benchmarkTaskCount} (${(row.coverage * 100).toFixed(1)}%)`,
    range: { value: (row) => row.coverage * 100, decimals: 1, unit: "%" },
    detail: {
      lines: [
        "Coverage = unique observed tasks ÷ benchmark tasks. It scales Score, so a configuration that solved a few tasks perfectly cannot outrank one that solved the whole benchmark.",
      ],
      inputs: (row) => [
        ["Observed tasks", row.taskCount.toLocaleString()],
        ["Benchmark tasks", row.benchmarkTaskCount.toLocaleString()],
        ["Coverage", percentText(row.coverage)],
        ["Complete", row.complete ? "yes" : "no"],
      ],
    },
  },
  {
    id: "firstExact(%)",
    name: "First exact (%)",
    tooltip: "Tasks that passed byte-exact verification on the first attempt.",
    cell: (row) => Number((row.firstExactRate * 100).toFixed(1)),
    range: { value: (row) => row.firstExactRate * 100, decimals: 1, unit: "%" },
    detail: {
      lines: [
        "Share of tasks solved before any recovery round. The distribution below is per task, so it shows whether the average hides a split between easy and hard tasks.",
      ],
      inputs: (row) => [["First exact rate", percentText(row.firstExactRate)]],
      samples: (row) => ({
        values: perTaskRates(row.trialSamples, (sample) => (sample.firstExactPassed ? 100 : 0)),
        label: "First-attempt outcome per task",
        unit: "%",
        decimals: 0,
      }),
    },
  },
  {
    id: "finalExact(%)",
    name: "Final exact (%)",
    tooltip: "Tasks that passed byte-exact verification after all recovery rounds.",
    cell: (row) => Number((row.finalExactRate * 100).toFixed(1)),
    range: { value: (row) => row.finalExactRate * 100, decimals: 1, unit: "%" },
    detail: {
      lines: [
        "Share of tasks solved after recovery rounds were allowed. The gap to the first-attempt rate is recovery work the harness had to absorb.",
      ],
      inputs: (row) => [
        ["Final exact rate", percentText(row.finalExactRate)],
        ["Recovery rounds used", row.recoveryRounds.toLocaleString()],
      ],
      samples: (row) => ({
        values: perTaskRates(row.trialSamples, (sample) => (sample.finalExactPassed ? 100 : 0)),
        label: "Final outcome per task",
        unit: "%",
        decimals: 0,
      }),
    },
  },
  {
    id: "recoveryGain",
    name: "Recovery gain",
    tooltip: "Final exact rate minus first exact rate, in percentage points.",
    cell: (row) => (row.recoveryGain == null ? null : Number((row.recoveryGain * 100).toFixed(1))),
    range: {
      value: (row) => (row.recoveryGain == null ? null : row.recoveryGain * 100),
      decimals: 1,
      unit: "pp",
    },
    detail: {
      lines: [
        "Recovery gain = final exact rate − first exact rate. It is extra work: high gain means the harness fixed mistakes the model made.",
      ],
      inputs: (row) => [
        [
          "Recovery gain",
          row.recoveryGain == null ? "—" : `${(row.recoveryGain * 100).toFixed(1)} pp`,
        ],
        ["Recovery rounds used", row.recoveryRounds.toLocaleString()],
      ],
      samples: (row) => ({
        values: perTaskRates(
          row.trialSamples,
          (sample) => (sample.finalExactPassed ? 100 : 0) - (sample.firstExactPassed ? 100 : 0),
        ),
        label: "Recovery per task",
        unit: "pp",
        decimals: 0,
      }),
    },
  },
  {
    id: "avgSeconds",
    name: "Avg seconds",
    tooltip: "Average total trial duration where timing was observed.",
    cell: (row) =>
      row.durationSummary.averageCase == null
        ? null
        : Number(row.durationSummary.averageCase.toFixed(1)),
    range: { value: (row) => row.durationSummary.averageCase, decimals: 1, unit: "s" },
    detail: {
      lines: [
        "Average wall-clock seconds for one trial, summed over its rounds. Only trials with a complete timing record take part; missing values stay missing instead of counting as zero.",
      ],
      inputs: (row) => [
        [
          "Average per trial",
          row.durationSummary.averageCase == null
            ? "—"
            : `${row.durationSummary.averageCase.toFixed(1)} s`,
        ],
        ["Timed trials", `${row.duration.observations} of ${row.observations}`],
      ],
      samples: (row) => ({
        values: row.trialSamples.map((sample) => sample.seconds),
        label: "Trial duration",
        unit: "s",
        decimals: 1,
      }),
    },
  },
  {
    id: "avgCost($)",
    name: "Avg cost ($)",
    tooltip: "Average observed model cost per trial. Missing values remain missing.",
    cell: (row) => {
      const value = observedAverage("cost")(row);
      return value == null ? null : Number(value.toFixed(4));
    },
    range: { value: observedAverage("cost"), decimals: 4, unit: "$" },
    detail: {
      lines: [
        "Average reported model cost for one trial. Providers that do not report cost leave the value missing, so the average covers only observed trials.",
      ],
      inputs: (row) => {
        const value = observedAverage("cost")(row);
        return [
          ["Average per trial", value == null ? "—" : `$${value.toFixed(4)}`],
          ["Reported trials", `${row.cost.observations} of ${row.observations}`],
        ];
      },
      samples: (row) => ({
        values: row.trialSamples.map((sample) => sample.costUsd),
        label: "Trial cost",
        unit: "$",
        decimals: 4,
      }),
    },
  },
  {
    id: "avgTokens",
    name: "Avg tokens",
    tooltip: "Average observed model tokens per trial. Missing values remain missing.",
    cell: (row) => {
      const value = observedAverage("tokens")(row);
      return value == null ? null : Math.round(value);
    },
    range: { value: observedAverage("tokens"), decimals: 0, unit: "tokens" },
    detail: {
      lines: [
        "Average total tokens for one trial, counting input, output and cache tokens where the provider reported them.",
      ],
      inputs: (row) => {
        const value = observedAverage("tokens")(row);
        return [
          ["Average per trial", value == null ? "—" : Math.round(value).toLocaleString()],
          ["Reported trials", `${row.tokens.observations} of ${row.observations}`],
        ];
      },
      samples: (row) => ({
        values: row.trialSamples.map((sample) => sample.tokens),
        label: "Trial tokens",
        unit: "",
        decimals: 0,
      }),
    },
  },
];

const COLUMN_BY_ID = new Map(COLUMNS.map((column) => [column.id, column]));

function formatNumber(value, decimals) {
  return decimals ? value.toFixed(decimals) : Math.round(value).toLocaleString();
}

function detailList(entries) {
  const list = document.createElement("dl");
  list.className = "details-metrics";
  for (const [term, value] of entries) {
    const item = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    item.append(dt, dd);
    list.append(item);
  }
  return list;
}

function detailsSection(title) {
  const section = document.createElement("section");
  section.className = "details-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  return section;
}

/**
 * Render a details table. An entry may be a plain array of cells, or an object
 * with an onClick; the first cell then becomes a button, so every listed thing
 * can be opened in turn and the reader can keep drilling down.
 */
function detailTable(headers, entries) {
  const table = document.createElement("table");
  table.className = "details-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const header of headers) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = header;
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const entry of entries) {
    const cells = Array.isArray(entry) ? entry : entry.cells;
    const onClick = Array.isArray(entry) ? null : entry.onClick;
    const row = document.createElement("tr");
    cells.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) {
        cell.scope = "row";
        if (onClick) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "details-link";
          button.textContent = value;
          button.addEventListener("click", onClick);
          cell.append(button);
        } else {
          cell.textContent = value;
        }
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    });
    body.append(row);
  }
  table.append(head, body);
  return table;
}

/** Show a quantile strip so spread is visible instead of only an average. */
function distributionBlock(sample) {
  const summary = describeDistribution(sample.values);
  if (!summary) return null;
  const section = detailsSection(sample.label);
  const span = summary.max - summary.min || 1;
  const position = (value) => ((value - summary.min) / span) * 100;
  const track = document.createElement("div");
  track.className = "distribution-track";
  const band = document.createElement("i");
  band.className = "distribution-band";
  band.style.left = `${position(summary.p25).toFixed(2)}%`;
  band.style.width = `${Math.max(1, position(summary.p75) - position(summary.p25)).toFixed(2)}%`;
  const median = document.createElement("i");
  median.className = "distribution-median";
  median.style.left = `${position(summary.median).toFixed(2)}%`;
  track.append(band, median);
  const text = (value) => `${formatNumber(value, sample.decimals)}${sample.unit}`;
  const legend = document.createElement("p");
  legend.className = "distribution-legend";
  legend.textContent = `min ${text(summary.min)} · p25 ${text(summary.p25)} · median ${text(summary.median)} · p75 ${text(summary.p75)} · max ${text(summary.max)} · mean ${text(summary.mean)} · ${summary.count} observations`;
  section.append(
    track,
    legend,
    detailList([
      ["Minimum", text(summary.min)],
      ["Median", text(summary.median)],
      ["Maximum", text(summary.max)],
      ["Mean", text(summary.mean)],
    ]),
  );
  return section;
}

/**
 * Close the dialog when the click lands outside it. The click target is the
 * dialog itself for the backdrop, so the coordinates decide whether the press
 * was really outside the panel or just on its padding.
 */
function closeOnOutsideClick(dialog) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) dialog.close();
  });
}

/**
 * Render one line of the card header. A part without an opener is plain text,
 * so a card always shows what it is made of and links to each piece.
 */
function renderHeaderParts(host, parts) {
  host.replaceChildren();
  const list = typeof parts === "string" ? [{ text: parts }] : (parts ?? []);
  const visible = list.filter((part) => part.text);
  host.hidden = visible.length === 0;
  visible.forEach((part, index) => {
    if (index) host.append(" · ");
    if (!part.onClick) {
      host.append(part.text);
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "details-link";
    button.textContent = part.text;
    button.title = `Open ${part.text}`;
    button.addEventListener("click", part.onClick);
    host.append(button);
  });
}

/**
 * One dialog serves every clickable element in the explorer. Following a link
 * inside an open dialog replaces its content instead of re-opening it.
 */
function openDetailsDialog(title, identity, sections) {
  const dialog = document.querySelector("#cell-details");
  renderHeaderParts(document.querySelector("#cell-details-title"), title);
  renderHeaderParts(document.querySelector("#cell-details-identity"), identity);
  document.querySelector("#cell-details-body").replaceChildren(...sections.filter(Boolean));
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

/** Link to a published file, opened in a new tab. */
function datasetLink(path, text, title = "") {
  const link = document.createElement("a");
  link.href = `${DATASET_PAGE}/${path}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${text} ↗`;
  if (title) link.title = title;
  return link;
}

/**
 * Provenance of the source submissions and runs behind a set of rows. Every
 * entry links to the published file it names, so a reader can check a number
 * instead of trusting it.
 */
function provenanceSection(rows) {
  const submissions = [...new Set(rows.flatMap((row) => row.submissionIds ?? []))].sort();
  const runIds = [...new Set(rows.flatMap((row) => row.runIds ?? []))].sort();
  const section = detailsSection("Provenance");
  const list = document.createElement("ul");
  list.className = "details-sources";
  for (const runId of runIds) {
    const run = state.index?.runs?.find((entry) => entry.runId === runId);
    const item = document.createElement("li");
    // The dataset index names the shards of each run, so the link is a real
    // file instead of a guessed URL pattern.
    const trials = run?.files?.trials?.path;
    item.append(
      trials
        ? datasetLink(
            `blob/main/${trials}`,
            runId,
            `Trial results of this run on Hugging Face: ${trials}`,
          )
        : runId,
    );
    const counts = run?.counts;
    if (counts) {
      const note = document.createElement("p");
      note.className = "details-note";
      note.textContent = `${counts.trials.toLocaleString()} trials · ${counts.rounds.toLocaleString()} rounds · ${counts.toolCalls.toLocaleString()} tool calls`;
      item.append(note);
    }
    list.append(item);
  }
  for (const submissionId of submissions) {
    const item = document.createElement("li");
    item.append(
      datasetLink(
        `tree/main/source/accepted/${submissionId}`,
        `Bundle ${submissionId.slice(0, 12)}…`,
        `Accepted bundle folder of ${submissionId}`,
      ),
    );
    list.append(item);
  }
  section.append(list);
  return section;
}

/** Score spread and the configurations behind a model, harness or cell. */
function configurationListSection(rows, title) {
  const section = detailsSection(`${title} (${rows.length})`);
  const summary = describeDistribution(rows.map((row) => row.score * 100).filter(Number.isFinite));
  if (summary) {
    const line = document.createElement("p");
    line.textContent = `Score across them: min ${summary.min.toFixed(1)} · median ${summary.median.toFixed(1)} · max ${summary.max.toFixed(1)}.`;
    section.append(line);
  }
  section.append(
    detailTable(
      ["Configuration", "Score", "Trials"],
      rows
        .toSorted((left, right) => right.score - left.score)
        .map((row) => ({
          cells: [
            configurationLabel(row),
            (row.score * 100).toFixed(3),
            row.observations.toLocaleString(),
          ],
          onClick: () => openConfigurationDetails([row]),
        })),
    ),
  );
  return section;
}

/** One line that names a configuration in lists and dialogs. */
function configurationLabel(row) {
  return `${canonicalModelFamily(row.modelFamily)} · ${row.harnessFamily} ${compactVersion(row.harnessVersion)} · ${row.thinking ?? "unknown"}`;
}

/**
 * Per-task outcomes: which benchmark tests actually passed. Family totals are
 * always shown, and the full task list appears when one configuration is open.
 */
function taskOutcomeSection(rows) {
  const tasks = [];
  for (const row of rows) {
    const byTask = new Map();
    for (const sample of row.trialSamples ?? []) {
      const item = byTask.get(sample.taskId) ?? { trials: 0, first: 0, final: 0 };
      item.trials += 1;
      item.first += Number(sample.firstExactPassed);
      item.final += Number(sample.finalExactPassed);
      byTask.set(sample.taskId, item);
    }
    for (const [taskId, item] of byTask) {
      tasks.push({
        taskId,
        family: taskFamily(taskId),
        trials: item.trials,
        first: item.first / item.trials,
        final: item.final / item.trials,
      });
    }
  }
  if (!tasks.length) return null;

  const families = new Map();
  for (const task of tasks) {
    const entry = families.get(task.family) ?? { tasks: 0, first: 0, final: 0 };
    entry.tasks += 1;
    entry.first += task.first;
    entry.final += task.final;
    families.set(task.family, entry);
  }
  const perFamily = [...families]
    .map(([family, entry]) => ({
      family,
      tasks: entry.tasks,
      first: entry.first / entry.tasks,
      final: entry.final / entry.tasks,
    }))
    .toSorted((left, right) => left.first - right.first || left.family.localeCompare(right.family));

  // Several configurations repeat the same task, so the unit is named honestly.
  const unit = rows.length > 1 ? "task observations" : "tasks";
  const missed = tasks.filter((task) => task.final < 1).length;
  const recovered = tasks.filter((task) => task.first < 1 && task.final === 1).length;
  const section = detailsSection(`Task outcomes (${tasks.length} ${unit})`);
  const line = document.createElement("p");
  line.textContent = `${tasks.length - missed} of ${tasks.length} ${unit} ended byte-exact; ${recovered} of them only after recovery. Worst families first.`;
  section.append(
    line,
    detailTable(
      ["Task family", rows.length > 1 ? "Observations" : "Tasks", "First exact", "Final exact"],
      perFamily.map((entry) => ({
        cells: [
          entry.family,
          String(entry.tasks),
          percentText(entry.first),
          percentText(entry.final),
        ],
        onClick: () => openTaskFamilyDetails(entry.family, rows),
      })),
    ),
  );
  if (rows.length === 1) {
    const scroll = document.createElement("div");
    scroll.className = "details-scroll";
    scroll.append(
      detailTable(
        ["Task", "Trials", "First", "Final"],
        tasks
          .toSorted(
            (left, right) => left.final - right.final || left.taskId.localeCompare(right.taskId),
          )
          .map((task) => ({
            cells: [
              task.taskId,
              String(task.trials),
              task.first === 1 ? "pass" : "miss",
              task.final === 1 ? "pass" : "miss",
            ],
            onClick: () => openTaskDetails(task.taskId, rows),
          })),
      ),
    );
    section.append(scroll);
  }
  return section;
}

/** Buttons that narrow the whole page to one value. */
function actionsSection(actions) {
  const section = document.createElement("div");
  section.className = "details-actions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      for (const [name, value] of action.filters) if (value) selectedValues(name).add(value);
      state.selected.clear();
      document.querySelector("#cell-details").close();
      render();
      syncUrl();
    });
    section.append(button);
  }
  return section;
}

/** Clickable parts of one configuration: model, agent, harness and reasoning. */
function identityParts(row) {
  const model = canonicalModelFamily(row.modelFamily);
  return [
    { text: model, onClick: () => openModelDetails(model) },
    ...(row.agentFamily
      ? [{ text: row.agentFamily, onClick: () => openAgentDetails(row.agentFamily) }]
      : []),
    {
      text: `${row.harnessFamily} ${compactVersion(row.harnessVersion)}`,
      onClick: () => openHarnessDetails(row.harnessFamily, row.harnessVersion),
    },
    ...(row.thinking
      ? [{ text: `thinking ${row.thinking}`, onClick: () => openThinkingDetails(row.thinking) }]
      : []),
  ];
}

/** Clickable identity parts shared by every row in a configuration scope. */
function configurationScopeParts(rows) {
  const [first] = rows;
  const same = (pick) => rows.every((row) => pick(row) === pick(first));
  const parts = [];
  const model = canonicalModelFamily(first.modelFamily);
  if (same((row) => canonicalModelFamily(row.modelFamily))) {
    parts.push({ text: model, onClick: () => openModelDetails(model) });
  }
  if (first.agentFamily && same((row) => row.agentFamily)) {
    parts.push({ text: first.agentFamily, onClick: () => openAgentDetails(first.agentFamily) });
  }
  if (same((row) => row.harnessFamily) && same((row) => row.harnessVersion)) {
    parts.push({
      text: `${first.harnessFamily} ${compactVersion(first.harnessVersion)}`,
      onClick: () => openHarnessDetails(first.harnessFamily, first.harnessVersion),
    });
  }
  if (first.thinking && same((row) => row.thinking)) {
    parts.push({
      text: `thinking ${first.thinking}`,
      onClick: () => openThinkingDetails(first.thinking),
    });
  }
  return parts.length ? parts : "Configuration selection";
}

/** Rows visible under the current filters that belong to one model. */
function rowsForModel(model) {
  return state.configurations.filter((row) => canonicalModelFamily(row.modelFamily) === model);
}

function rowsForHarness(harness, version) {
  return state.configurations.filter(
    (row) => row.harnessFamily === harness && (version == null || row.harnessVersion === version),
  );
}

function rowsForAgent(agent) {
  return state.configurations.filter((row) => row.agentFamily === agent);
}

function rowsForThinking(thinking) {
  return state.configurations.filter((row) => row.thinking === thinking);
}

const totalTrials = (rows) =>
  rows.reduce((total, row) => total + row.observations, 0).toLocaleString();
/** Score, coverage and measured share of one group of configurations. */
function groupSummary(rows) {
  const group = aggregateGroupScore(rows);
  return [
    ["Score", group.score == null ? "—" : (group.score * 100).toFixed(1)],
    ["Coverage", percentText(group.coverage)],
    ["Tasks measured", `${group.taskCount} of ${group.benchmarkTaskCount}`],
  ];
}

/**
 * One identity value — a model, an agent, a harness or a reasoning mode — with
 * every configuration behind it, its task outcomes and its provenance.
 */
function openGroupDetails({ kind, card, title, identity, note, summary, rows, filters }) {
  const section = detailsSection("How this value is computed");
  const paragraph = document.createElement("p");
  paragraph.textContent = note;
  const formula = document.createElement("p");
  formula.textContent =
    "Score = coverage × (0.75 × first exact rate + 0.25 × final exact rate), with every trial of the group pooled per task, so a partial run adds evidence instead of pulling the group down.";
  section.append(paragraph, formula, detailList(summary));
  setCard(card);
  openDetailsDialog(title, identity, [
    section,
    configurationListSection(rows, "Visible configurations"),
    taskOutcomeSection(rows),
    provenanceSection(rows),
    actionsSection([{ label: `Filter table to this ${kind}`, filters }]),
  ]);
}

/** Everything worth knowing about one configuration. */
function openConfigurationDetails(rows) {
  const [first] = rows;
  if (!first) return;
  const single = rows.length === 1 ? first : null;
  const sections = [];
  if (single) {
    sections.push(
      (() => {
        const section = detailsSection("How this value is computed");
        const paragraph = document.createElement("p");
        paragraph.textContent =
          "Score = coverage × (0.75 × first exact rate + 0.25 × final exact rate).";
        section.append(
          paragraph,
          detailList([
            ["Coverage", percentText(single.coverage)],
            ["Quality score", percentText(single.qualityScore)],
            ["First exact rate", percentText(single.firstExactRate)],
            ["Final exact rate", percentText(single.finalExactRate)],
            ["Trials", single.observations.toLocaleString()],
            ["Recovery rounds", single.recoveryRounds.toLocaleString()],
          ]),
        );
        return section;
      })(),
    );
  } else {
    sections.push(configurationListSection(rows, "Configurations in this selection"));
  }
  sections.push(taskOutcomeSection(rows), provenanceSection(rows));
  sections.push(
    actionsSection([
      {
        label: `Filter table to this ${single ? "configuration" : "model and harness"}`,
        filters: [
          ["model", canonicalModelFamily(first.modelFamily)],
          ["harness", first.harnessFamily],
          ...(first.harnessVersion
            ? [["harnessVersion", `${first.harnessFamily}\t${first.harnessVersion}`]]
            : []),
        ],
      },
    ]),
  );
  // One shared identity renderer prevents callers from inventing a second,
  // conflicting title for the same configuration scope.
  openDetailsDialog(
    single ? identityParts(first) : configurationScopeParts(rows),
    single ? null : `${rows.length} configurations`,
    sections,
  );
  setCard(`config:${scopeToken(rows)}`);
}

/** One model: every visible configuration it ran, plus its task outcomes. */
function openModelDetails(model) {
  const rows = rowsForModel(model);
  if (!rows.length) return;
  openGroupDetails({
    kind: "model",
    card: `model:${model}`,
    title: `Model: ${model}`,
    identity: rows[0]?.provider ? `Provider ${rows[0].provider}` : "Model family",
    note: "Every accepted configuration recorded for this model under the current filters. The ranking score pools their trials task by task, so a model with several harnesses is judged across all of them.",
    summary: [
      ["Model", model],
      ["Configurations", String(rows.length)],
      ["Harnesses", String(new Set(rows.map((row) => row.harnessFamily)).size)],
      ["Trials", totalTrials(rows)],
      ...groupSummary(rows),
    ],
    rows,
    filters: [["model", model]],
  });
}

/** One agent or CLI across every model it drove. */
function openAgentDetails(agent) {
  const rows = rowsForAgent(agent);
  if (!rows.length) return;
  const [first] = rows;
  openGroupDetails({
    kind: "agent",
    card: `agent:${agent}`,
    title: `Agent: ${agent}`,
    identity: first?.agentVersion ? `Version ${first.agentVersion}` : "Agent or CLI",
    note: "The agent is the client that talked to the model. Comparing agents separates model quality from prompt and control-loop design.",
    summary: [
      ["Agent", agent],
      ["Agent version", first?.agentVersion ?? "—"],
      ["Configurations", String(rows.length)],
      ["Models", String(new Set(rows.map((row) => canonicalModelFamily(row.modelFamily))).size)],
      ["Trials", totalTrials(rows)],
      ...groupSummary(rows),
    ],
    rows,
    filters: [["agent", agent]],
  });
}

/** One reasoning mode across every configuration that requested it. */
function openThinkingDetails(thinking) {
  const rows = rowsForThinking(thinking);
  if (!rows.length) return;
  openGroupDetails({
    kind: "thinking mode",
    card: `thinking:${thinking}`,
    title: `Thinking: ${thinking}`,
    identity: "Requested reasoning level",
    note: "The reasoning level requested from the model. When reasoning is not fixed by a filter, accepted modes are rolled into one configuration.",
    summary: [
      ["Thinking", thinking],
      ["Configurations", String(rows.length)],
      ["Harnesses", String(new Set(rows.map((row) => row.harnessFamily)).size)],
      ["Trials", totalTrials(rows)],
      ...groupSummary(rows),
    ],
    rows,
    filters: [["reasoning", thinking]],
  });
}

/** One harness or one harness version across every model that ran it. */
function openHarnessDetails(harness, version) {
  const rows = rowsForHarness(harness, version);
  if (!rows.length) return;
  openGroupDetails({
    kind: "harness",
    card: `harness:${harness}@${version ?? ""}`,
    title: `Harness: ${harness}`,
    identity: version ? `Version ${compactVersion(version)}` : "All visible versions",
    note: "The harness defines which tools exist and how they are described. Two versions of one harness are different configurations and are scored separately.",
    summary: [
      ["Harness", harness],
      ["Version", version ?? "all visible versions"],
      ["Configurations", String(rows.length)],
      ["Models", String(new Set(rows.map((row) => canonicalModelFamily(row.modelFamily))).size)],
      ["Trials", totalTrials(rows)],
      ...groupSummary(rows),
    ],
    rows,
    filters: [
      ["harness", harness],
      ...(version ? [["harnessVersion", `${harness}\t${version}`]] : []),
    ],
  });
}

/** Official family score for one configuration, from the shared aggregation. */
function familyScore(row, family) {
  return precomputedFamilyScore(row, family);
}

/** Per-task rates of one family, read from the trial samples already loaded. */
function familyTasks(rows, family) {
  const byTask = new Map();
  for (const row of rows) {
    for (const sample of row.trialSamples ?? []) {
      if (taskFamily(sample.taskId) !== family) continue;
      const item = byTask.get(sample.taskId) ?? { trials: 0, first: 0, final: 0 };
      item.trials += 1;
      item.first += Number(sample.firstExactPassed);
      item.final += Number(sample.finalExactPassed);
      byTask.set(sample.taskId, item);
    }
  }
  return [...byTask].map(([taskId, item]) => ({
    taskId,
    trials: item.trials,
    first: item.first / item.trials,
    final: item.final / item.trials,
  }));
}

/** One task family: its tasks, its score, and how other configurations did. */
function openTaskFamilyDetails(family, rows) {
  const tasks = familyTasks(rows, family);
  if (!tasks.length) return;

  const explain = detailsSection("How this value is computed");
  const paragraph = document.createElement("p");
  paragraph.textContent =
    "The family score uses the same formula as the whole benchmark, but only the tasks of this family: coverage inside the family × (0.75 × first exact rate + 0.25 × final exact rate).";
  const scored = rows
    .map((row) => ({ row, score: familyScore(row, family) }))
    .filter((entry) => entry.score);
  const [only] = scored;
  explain.append(paragraph);
  if (scored.length === 1 && only) {
    explain.append(
      detailList([
        ["Family score", percentText(only.score.score)],
        ["First exact", percentText(only.score.firstExactRate)],
        ["Final exact", percentText(only.score.finalExactRate)],
        ["Tasks in family", only.score.taskCount.toLocaleString()],
        ["Trials", only.score.observations.toLocaleString()],
      ]),
    );
  } else if (scored.length > 1) {
    // A single configuration's number would be a lie about the whole scope.
    const spread = describeDistribution(scored.map((entry) => entry.score.score * 100));
    const scope = document.createElement("p");
    scope.textContent = `This card covers ${scored.length} configurations, so the numbers below describe the spread across them. Open one configuration for its own family score.`;
    explain.append(
      scope,
      detailList([
        ["Family score", percentText(pooledFamilyScore(rows, family).score)],
        ["Configurations", String(scored.length)],
        ["Median family score", `${spread.median.toFixed(1)}%`],
        ["Best family score", `${spread.max.toFixed(1)}%`],
        ["Worst family score", `${spread.min.toFixed(1)}%`],
        ["Tasks in family", String(tasks.length)],
      ]),
    );
  }

  const list = detailsSection(`Tasks in this family (${tasks.length})`);
  list.append(
    detailTable(
      ["Task", "Trials", "First", "Final"],
      tasks
        .toSorted(
          (left, right) => left.final - right.final || left.taskId.localeCompare(right.taskId),
        )
        .map((task) => ({
          cells: [
            task.taskId,
            String(task.trials),
            task.first === 1 ? "pass" : "miss",
            task.final === 1 ? "pass" : "miss",
          ],
          onClick: () => openTaskDetails(task.taskId, rows),
        })),
    ),
  );

  // Every visible configuration that ran this family, best first.
  const comparison = state.configurations
    .map((row) => ({ row, score: familyScore(row, family) }))
    .filter((entry) => entry.score)
    .toSorted((left, right) => right.score.score - left.score.score);
  const across = detailsSection(`Across configurations (${comparison.length})`);
  across.append(
    detailTable(
      ["Configuration", "Family score", "Final exact"],
      comparison.map((entry) => ({
        cells: [
          configurationLabel(entry.row),
          percentText(entry.score.score),
          percentText(entry.score.finalExactRate),
        ],
        onClick: () => openConfigurationDetails([entry.row]),
      })),
    ),
  );

  setCard(`family:${family}|${scopeToken(rows)}`);
  openDetailsDialog(
    `Task family: ${family}`,
    rows.length === 1 && rows[0]
      ? identityParts(rows[0])
      : `Family score across ${scored.length || rows.length} configurations`,
    [explain, list, across, provenanceSection(rows)],
  );
}

/** One benchmark task: its result here and in every other configuration. */
function openTaskDetails(taskId, rows) {
  const family = taskFamily(taskId);
  const task = familyTasks(rows, family).find((candidate) => candidate.taskId === taskId);
  if (!task) return;

  const explain = detailsSection("How this value is computed");
  const paragraph = document.createElement("p");
  paragraph.textContent =
    "One trial is one execution of this task. First exact means the workspace matched byte-for-byte before any recovery round; final exact means it matched at the end.";
  explain.append(
    paragraph,
    detailList([
      ["Task", taskId],
      ["Task family", family],
      ["Trials", String(task.trials)],
      ["First exact", percentText(task.first)],
      ["Final exact", percentText(task.final)],
    ]),
  );

  const outcomes = state.configurations
    .flatMap((row) => {
      const samples = (row.trialSamples ?? []).filter((sample) => sample.taskId === taskId);
      if (!samples.length) return [];
      return [
        {
          row,
          first: mean(samples.map((sample) => Number(sample.firstExactPassed))),
          final: mean(samples.map((sample) => Number(sample.finalExactPassed))),
          trials: samples.length,
        },
      ];
    })
    .toSorted((left, right) => right.final - left.final || right.first - left.first);
  const across = detailsSection(`Across configurations (${outcomes.length})`);
  across.append(
    detailTable(
      ["Configuration", "First", "Final", "Trials"],
      outcomes.map((entry) => ({
        cells: [
          configurationLabel(entry.row),
          percentText(entry.first),
          percentText(entry.final),
          String(entry.trials),
        ],
        onClick: () => openConfigurationDetails([entry.row]),
      })),
    ),
  );

  setCard(`task:${taskId}|${scopeToken(rows)}`);
  openDetailsDialog(
    `Task: ${taskId}`,
    rows.length === 1 ? identityParts(rows[0]) : `${rows.length} configurations`,
    [explain, across, provenanceSection(rows)],
  );
}

/**
 * One tool: how often it is called, and how that varies between trials.
 * @param {string} tool
 * @param {(Record<string, any> | undefined)[]} rows configurations the card covers
 * @param {boolean} narrowed true when those rows restrict the card to one setup
 */
function openToolDetails(tool, rows, narrowed) {
  const all = toolTrialCounts(
    state.index,
    state.profiles,
    state.trials,
    state.rounds,
    state.toolCalls,
    tool,
    activeFilters(),
  );
  const keys = narrowed ? new Set(rows.map(cellKeyFromRow)) : null;
  const scoped = keys ? all.filter((entry) => keys.has(entry.key)) : all;
  if (!scoped.length) return;
  const calls = scoped.reduce((total, entry) => total + entry.calls, 0);
  const used = scoped.filter((entry) => entry.calls > 0).length;
  const [scopedRow] = narrowed ? rows : [];

  const explain = detailsSection("How this value is computed");
  const paragraph = document.createElement("p");
  paragraph.textContent =
    "Every normalised tool event that named this tool counts once. Trials that never called it stay in the denominator, so the average is honest about how often it is really used.";
  explain.append(
    paragraph,
    detailList([
      ["Calls", calls.toLocaleString()],
      ["Trials", scoped.length.toLocaleString()],
      ["Calls per trial", (calls / scoped.length).toFixed(2)],
      [
        "Trials that used it",
        `${used} of ${scoped.length} (${((used / scoped.length) * 100).toFixed(1)}%)`,
      ],
      ["Observations", String(scoped.length)],
      [
        "Scope",
        scopedRow
          ? `${canonicalModelFamily(scopedRow.modelFamily)} · ${scopedRow.harnessFamily} ${compactVersion(scopedRow.harnessVersion)}`
          : "all visible configurations",
      ],
    ]),
  );

  // Per-configuration popularity, strongest first.
  const byKey = new Map();
  for (const entry of scoped) {
    const group = byKey.get(entry.key) ?? { calls: 0, trials: 0, used: 0 };
    group.calls += entry.calls;
    group.trials += 1;
    group.used += Number(entry.calls > 0);
    byKey.set(entry.key, group);
  }
  const ranked = [...byKey]
    .map(([groupKey, group]) => {
      const [groupModel, groupHarness, groupVersion] = JSON.parse(groupKey);
      return { groupKey, groupModel, groupHarness, groupVersion, ...group };
    })
    .toSorted((left, right) => right.calls / right.trials - left.calls / left.trials);

  const section = detailsSection(`Where it is used (${ranked.length} configurations)`);
  section.append(
    detailTable(
      ["Configuration", "Calls/trial", "Used in", "Calls"],
      ranked.slice(0, 40).map((group) => ({
        cells: [
          `${group.groupModel} · ${group.groupHarness} ${compactVersion(group.groupVersion)}`,
          (group.calls / group.trials).toFixed(2),
          `${group.used}/${group.trials}`,
          group.calls.toLocaleString(),
        ],
        onClick: () => {
          const rows = rowsForCell({
            model: group.groupModel,
            harness: group.groupHarness,
            version: group.groupVersion,
          });
          if (rows.length) openConfigurationDetails(rows);
        },
      })),
    ),
  );

  setCard(`tool:${tool}|${narrowed ? scopeToken(rows) : "all"}`);
  openDetailsDialog(
    `Tool: ${tool}`,
    scopedRow ? identityParts(scopedRow) : "All visible configurations",
    [
      explain,
      distributionBlock({
        values: scoped.map((entry) => entry.calls),
        label: "Calls per trial",
        unit: "",
        decimals: 0,
      }),
      section,
      ...(scopedRow
        ? [
            actionsSection([
              {
                label: "Filter table to this configuration",
                filters: [
                  ["model", canonicalModelFamily(scopedRow.modelFamily)],
                  ["harness", scopedRow.harnessFamily],
                  ...(scopedRow.harnessVersion
                    ? [
                        [
                          "harnessVersion",
                          `${scopedRow.harnessFamily}\t${scopedRow.harnessVersion}`,
                        ],
                      ]
                    : []),
                ],
              },
            ]),
          ]
        : []),
    ],
  );
}

/** Open the explanation, spread and provenance behind one clicked cell. */
function openCellDetails(row, index, columnId) {
  const column = COLUMN_BY_ID.get(columnId);
  if (!column?.detail) return;
  const explain = detailsSection("How this value is computed");
  for (const line of column.detail.lines) {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    explain.append(paragraph);
  }
  explain.append(detailList(column.detail.inputs(row, index)));

  const sample = column.detail.samples?.(row);
  const identity = column.detail.identity?.(row);
  const sections = [explain];
  const distribution = sample ? distributionBlock(sample) : null;
  if (distribution) sections.push(distribution);
  if (identity) {
    sections.push(
      configurationListSection(
        rowsForColumn(column, identity),
        `Visible configurations with this ${column.name.toLowerCase()}`,
      ),
    );
  }
  // The rest of the dialog describes the whole configuration, so a metric click
  // and a configuration click never disagree about the same row.
  sections.push(taskOutcomeSection([row]), provenanceSection([row]));
  if (column.detail.filter) {
    sections.push(
      actionsSection([
        {
          label: `Filter table to this ${column.name.toLowerCase()}`,
          filters: [[column.detail.filter.name, column.detail.filter.value(row)]],
        },
      ]),
    );
  }
  openDetailsDialog(`${column.name}: ${column.cell(row, index)}`, identityParts(row), sections);
  setCard(`metric:${column.id}|${configToken(row)}`);
}

/** Rows that share the clicked value in one column. */
function rowsForColumn(column, identity) {
  return state.configurations.filter((row) => column.detail.identity(row) === identity);
}

function renderResultsTable(rows) {
  const host = document.querySelector("#results-grid");
  resultsGrid?.destroy();
  host.replaceChildren();
  state.rows = rows.toSorted((left, right) => right.score - left.score);
  const data = state.rows.map((row, index) => [
    ...COLUMNS.map((column) => column.cell(row, index)),
    index,
  ]);
  const columns = COLUMNS.map((column) => ({
    name: column.name,
    id: column.id,
    sort: column.sort === false ? false : {},
    formatter: (cell, gridRow) => {
      // Sorting moves rows, so the original position travels in a hidden column.
      const index = gridRow.cells.at(-1).data;
      const row = state.rows[index];
      if (!row) return cell;
      return h(
        "button",
        {
          type: "button",
          className: "cell-detail",
          title: `Explain ${column.name.toLowerCase()}`,
          onClick: () => (column.open ? column.open(row) : openCellDetails(row, index, column.id)),
        },
        cell == null ? "—" : String(cell),
      );
    },
  }));
  columns.push({ name: "row", id: "row", hidden: true, sort: false });
  resultsGrid = new Grid({
    columns,
    data,
    autoWidth: false,
    sort: true,
    className: {
      container: "results-table",
      table: "results-table-table",
      search: "results-table-search",
    },
  }).render(host);
  addHeaderControls(host);
  addOverflowTitles(host);
}

/** Truncated cells keep their full value available on hover. */
function addOverflowTitles(host) {
  for (const cell of host.querySelectorAll("tbody td")) {
    if (cell.scrollWidth > cell.clientWidth + 1) cell.title = cell.textContent?.trim() ?? "";
  }
}

/**
 * Pooled family score of a set of configurations, from the shared aggregation.
 * The trials of every configuration are pooled per task, so a whole model and
 * one of its harnesses are measured the same way.
 */
function pooledFamilyScore(rows, family) {
  return aggregateGroupScore(rows.map((row) => familyScore(row, family)).filter(Boolean));
}

/** Tasks the benchmark defines in each family, counted from the loaded trials. */
let familyTotals = null;
function familyTaskTotals() {
  familyTotals ??= (() => {
    const byFamily = new Map();
    for (const trial of state.trials) {
      const family = taskFamily(trial.taskId);
      byFamily.set(family, (byFamily.get(family) ?? new Set()).add(trial.taskId));
    }
    return new Map([...byFamily].map(([family, tasks]) => [family, tasks.size]));
  })();
  return familyTotals;
}

function familyEntry(cell, family) {
  const group = pooledFamilyScore(rowsForCell(cell), family);
  return group.score == null
    ? null
    : {
        score: group.score * 100,
        finalExactRate: group.finalExactRate * 100,
        taskCount: group.taskCount,
      };
}

/** Family score for every selected configuration, from the shared aggregation. */
function comparisonFamilyRows(selectedCells) {
  const families = [...new Set(state.trials.map((trial) => taskFamily(trial.taskId)))].sort();
  return families.map((family) => ({
    family,
    entries: selectedCells.map((cell) => familyEntry(cell, family)),
  }));
}

/**
 * Header row shared by the two comparison tables. The label names the row
 * column, and each selected configuration carries its series colour as a
 * background, so a header and its matrix frame read as the same thing.
 */
function selectionTableHead(selectedCells, label) {
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.scope = "col";
  corner.textContent = label;
  headRow.append(corner);
  selectedCells.forEach((cell, index) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.className = "selection-head";
    th.style.setProperty("--selection-color", COLORS[index]);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "selection-label";
    button.title = `Open ${cell.model} · ${cell.label}`;
    const harness = document.createElement("span");
    harness.className = "selection-harness";
    harness.textContent = cell.overall
      ? "Overall"
      : `${cell.harness} ${compactVersion(cell.version)}`;
    const model = document.createElement("span");
    model.className = "selection-model";
    model.textContent = cell.model;
    button.append(harness, model);
    button.addEventListener("click", () => openConfigurationDetails(rowsForCell(cell)));
    th.append(button);
    headRow.append(th);
  });
  head.append(headRow);
  return head;
}
/**
 * Best and worst value in a row, so two close numbers need no squinting.
 * Returns nulls when everything is equal or only one value exists.
 */
function rowExtremes(values) {
  const finite = values.filter((value) => value != null);
  if (finite.length < 2) return { best: null, worst: null };
  const best = Math.max(...finite);
  const worst = Math.min(...finite);
  return best === worst ? { best: null, worst: null } : { best, worst };
}

/** Small triangle that marks the best or worst value of a row. */
function extremeMark(kind) {
  const mark = document.createElement("b");
  mark.className = `tool-usage-mark tool-usage-mark-${kind}`;
  mark.textContent = kind === "best" ? "▲" : "▼";
  mark.title = kind === "best" ? "Best in this row" : "Worst in this row";
  return mark;
}

/** Task-family scores for the selected configurations, weakest family first. */
function renderTaskFamilies(selectedCells) {
  const host = document.querySelector("#task-families");
  const context = document.querySelector("#task-family-context");
  host.replaceChildren();
  if (!selectedCells.length) {
    context.textContent = "";
    return;
  }
  const rows = comparisonFamilyRows(selectedCells).toSorted(
    (left, right) =>
      mean(left.entries.map((entry) => entry?.score ?? 0)) -
        mean(right.entries.map((entry) => entry?.score ?? 0)) ||
      left.family.localeCompare(right.family),
  );
  const maximum = Math.max(
    0,
    ...rows.flatMap((row) => row.entries.map((entry) => entry?.score ?? 0)),
  );
  context.textContent = `${rows.length} families · score · final exact`;

  const table = document.createElement("table");
  table.className = "tool-usage-table";
  table.append(selectionTableHead(selectedCells, "Task family"));
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const heading = document.createElement("th");
    heading.scope = "row";
    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = "selection-label";
    nameButton.textContent = row.family;
    nameButton.title = `Open ${row.family} across every visible configuration`;
    nameButton.addEventListener("click", () =>
      openTaskFamilyDetails(row.family, state.configurations),
    );
    heading.append(nameButton);
    tr.append(heading);
    const extremes = rowExtremes(row.entries.map((entry) => entry?.score ?? null));
    row.entries.forEach((entry, index) => {
      const td = document.createElement("td");
      if (!entry) {
        td.className = "tool-usage-missing";
        td.textContent = "—";
      } else {
        const cell = selectedCells[index];
        const bar = document.createElement("button");
        bar.type = "button";
        bar.className = "tool-usage-bar";
        bar.style.setProperty("--bar-width", `${maximum ? (entry.score / maximum) * 100 : 0}%`);
        bar.style.setProperty("--bar-color", COLORS[index]);
        const value = document.createElement("span");
        value.textContent = `${entry.score.toFixed(1)} · ${entry.finalExactRate.toFixed(0)}%`;
        bar.title = `${row.family}\n${cell.model} · ${cell.label}\nFamily score ${entry.score.toFixed(1)} · final exact ${entry.finalExactRate.toFixed(1)}%\n${entry.taskCount} tasks\nSelect for the tasks in this family`;
        bar.addEventListener("click", () => openTaskFamilyDetails(row.family, rowsForCell(cell)));
        // Only the score row has a "better" end, so only it gets a judgement mark.
        if (entry.score === extremes.best) bar.append(extremeMark("best"));
        else if (entry.score === extremes.worst) bar.append(extremeMark("worst"));
        bar.append(value);
        td.append(bar);
      }
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(body);
  host.append(table);
}

/** Compact version marker, e.g. "codex-cli 0.153.4" becomes "0.153.4". */
function compactVersion(version) {
  return version?.match(/[\d][\w.-]*$/u)?.[0] ?? version ?? "unknown";
}

/**
 * Tool usage of one matrix cell. A cell that covers several harnesses sums the
 * calls and trials of all of them, so calls per trial stays a rate over trials.
 */
function usageForCell(cell, usageRows) {
  const keys = new Set(rowsForCell(cell).map(cellKeyFromRow));
  const mine = usageRows.filter((row) => keys.has(row.key));
  const trials = mine.reduce((sum, row) => sum + row.trials, 0);
  const calls = mine.reduce((sum, row) => sum + row.calls, 0);
  const byTool = new Map();
  for (const row of mine) {
    for (const tool of row.tools) byTool.set(tool.tool, (byTool.get(tool.tool) ?? 0) + tool.calls);
  }
  return {
    trials,
    calls,
    callsPerTrial: trials ? calls / trials : 0,
    tools: [...byTool].map(([tool, toolCalls]) => ({
      tool,
      calls: toolCalls,
      share: calls ? toolCalls / calls : 0,
      callsPerTrial: trials ? toolCalls / trials : 0,
    })),
  };
}

/** Render exact tool frequency for the selected model and harness cells. */
function renderToolUsage(selectedCells) {
  const host = document.querySelector("#tool-usage");
  const context = document.querySelector("#tool-usage-context");
  host.replaceChildren();
  if (!selectedCells.length) {
    context.textContent = "";
    return;
  }
  const usageRows = aggregateToolUsage(
    state.index,
    state.profiles,
    state.trials,
    state.rounds,
    state.toolCalls,
    activeFilters(),
  );
  const selectedUsage = selectedCells.map((cell) => usageForCell(cell, usageRows));
  const toolNames = [
    ...new Set(selectedUsage.flatMap((usage) => usage?.tools.map((tool) => tool.tool) ?? [])),
  ].sort((left, right) => {
    const total = (tool) =>
      selectedUsage.reduce(
        (sum, usage) => sum + (usage?.tools.find((item) => item.tool === tool)?.callsPerTrial ?? 0),
        0,
      );
    return total(right) - total(left) || left.localeCompare(right);
  });
  const maximum = Math.max(
    0,
    ...selectedUsage.flatMap((usage) => usage?.tools.map((tool) => tool.callsPerTrial) ?? []),
  );
  context.textContent = `${toolNames.length} tools · bars show calls per trial`;
  const table = document.createElement("table");
  table.className = "tool-usage-table";
  table.append(selectionTableHead(selectedCells, "Tool"));
  const body = document.createElement("tbody");
  for (const toolName of toolNames) {
    const row = document.createElement("tr");
    const heading = document.createElement("th");
    heading.scope = "row";
    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = "selection-label";
    nameButton.textContent = toolName;
    nameButton.title = `Open ${toolName} usage`;
    nameButton.addEventListener("click", () =>
      openToolDetails(toolName, state.configurations, false),
    );
    heading.append(nameButton);
    row.append(heading);
    selectedUsage.forEach((usage, index) => {
      const td = document.createElement("td");
      const tool = usage.tools.find((item) => item.tool === toolName);
      if (!tool) {
        td.className = "tool-usage-missing";
        td.textContent = "—";
      } else {
        const bar = document.createElement("button");
        bar.type = "button";
        bar.className = "tool-usage-bar";
        bar.style.setProperty(
          "--bar-width",
          `${maximum ? (tool.callsPerTrial / maximum) * 100 : 0}%`,
        );
        bar.style.setProperty("--bar-color", COLORS[index]);
        const value = document.createElement("span");
        value.textContent = `${tool.callsPerTrial.toFixed(2)} · ${(tool.share * 100).toFixed(0)}%`;
        bar.title = `${toolName}\n${tool.calls.toLocaleString()} calls\n${tool.callsPerTrial.toFixed(2)} calls/trial\n${(tool.share * 100).toFixed(1)}% of this configuration's calls\nSelect for the full distribution`;
        bar.addEventListener("click", () =>
          openToolDetails(toolName, rowsForCell(selectedCells[index]), true),
        );
        bar.append(value);
        td.append(bar);
      }
      row.append(td);
    });
    body.append(row);
  }
  table.append(body);
  host.append(table);
}
function renderComparison(cells) {
  const selectedCells = [...state.selected].flatMap((key) => {
    const cell = cells.find((candidate) => candidate.key === key);
    return cell ? [cell] : [];
  });
  document.querySelector("#selection-panel").hidden = selectedCells.length === 0;
  document.querySelector("#selection-context").textContent =
    `Comparing ${selectedCells.length} configuration${selectedCells.length === 1 ? "" : "s"}.`;
  if (!selectedCells.length) {
    renderTaskFamilies([]);
    renderToolUsage([]);
    return;
  }
  renderToolUsage(selectedCells);
  renderTaskFamilies(selectedCells);
}

function renderActiveFilters() {
  const host = document.querySelector("#active-filters");
  host.replaceChildren();
  for (const [name, values] of state.filters) {
    for (const value of values) {
      const chip = document.createElement("span");
      chip.className = "active-filter";
      const key = document.createElement("b");
      key.textContent = FILTER_LABELS[name] ?? name;
      const label = document.createElement("span");
      label.textContent = value;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove " + name + " filter " + value);
      remove.addEventListener("click", () => {
        selectedValues(name).delete(value);
        state.selected.clear();
        render();
        syncUrl();
      });
      chip.append(key, label, remove);
      host.append(chip);
    }
  }
}
function render() {
  const configurationRows = aggregateLeaderboard(
    state.index,
    state.profiles,
    state.trials,
    state.rounds,
    activeFilters(),
  );
  const cells = matrixCells(configurationRows);
  const models = cells.filter((cell) => cell.overall).length;
  const harnessColumns = new Set(cells.filter((cell) => !cell.overall).map((cell) => cell.label))
    .size;
  document.querySelector("#summary-context").textContent =
    `${models} models · ${harnessColumns} harness columns`;
  state.allRows = aggregateLeaderboard(state.index, state.profiles, state.trials, state.rounds, {});
  state.configurations = configurationRows.toSorted((left, right) => right.score - left.score);
  renderMatrix(cells);
  renderComparison(cells);
  renderResultsTable(configurationRows.filter(matchesRanges));
  renderRangeFilters();
  buildFilterMenus(state.allRows);
  renderActiveFilters();
  document.querySelector("#reset-filters").hidden = ![...state.filters.values()].some(
    (values) => values.size,
  );
}

function filterOption(parent, filterName, item) {
  const selected = selectedValues(filterName);
  const option = document.createElement("label");
  option.className = "filter-value";
  const check = document.createElement("input");
  check.className = "filter-value-check";
  check.type = "checkbox";
  check.checked = selected.has(item.value);
  check.setAttribute("aria-label", item.label);
  const label = document.createElement("span");
  label.className = "filter-value-label";
  label.textContent = item.label;
  const count = document.createElement("span");
  count.className = "filter-value-count";
  count.textContent = String(item.count ?? 0);
  option.append(check, label, count);
  check.addEventListener("change", () => {
    if (check.checked) selected.add(item.value);
    else selected.delete(item.value);
    state.selected.clear();
    render();
    syncUrl();
  });
  parent.append(option);
}
function uniqueOptions(entries) {
  const options = new Map();
  for (const entry of entries) {
    const current = options.get(entry.value);
    if (current) current.configurations.add(entry.configuration);
    else options.set(entry.value, { ...entry, configurations: new Set([entry.configuration]) });
  }
  return [...options.values()]
    .map(({ value, label, configurations }) => ({ value, label, count: configurations.size }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
function buildFilterMenus(rows) {
  const allowedConfigurations = new Set(rows.flatMap((row) => row.configurationHashes));
  const allowedRuns = new Set(rows.flatMap((row) => row.runIds));
  const profiles = state.profiles.filter((profile) =>
    allowedConfigurations.has(profile.configurationHash),
  );
  const runs = state.index.runs.filter((run) => allowedRuns.has(run.runId));
  const categories = [
    {
      key: "model",
      label: "Model",
      options: uniqueOptions(
        profiles.map((profile) => ({
          value: canonicalModelFamily(profile.modelFamily),
          label: canonicalModelFamily(profile.modelFamily),
          configuration: profile.configurationHash,
        })),
      ),
    },
    {
      key: "agent",
      label: "Agent",
      options: uniqueOptions(
        profiles.map((profile) => ({
          value: profile.agentFamily,
          label: profile.agentFamily,
          configuration: profile.configurationHash,
        })),
      ),
    },
    {
      key: "harness",
      label: "Harness",
      options: uniqueOptions(
        profiles.map((profile) => ({
          value: profile.harnessFamily,
          label: profile.harnessFamily,
          configuration: profile.configurationHash,
        })),
      ),
    },
    {
      key: "harnessVersion",
      label: "Harness version",
      options: uniqueOptions(
        profiles.flatMap((profile) =>
          profile.harnessVersion
            ? [
                {
                  value: `${profile.harnessFamily}\t${profile.harnessVersion}`,
                  label: `${profile.harnessFamily} · ${profile.harnessVersion}`,
                  configuration: profile.configurationHash,
                },
              ]
            : [],
        ),
      ),
    },
    {
      key: "reasoning",
      label: "Thinking",
      options: uniqueOptions(
        profiles.flatMap((profile) =>
          profile.thinking
            ? [
                {
                  value: profile.thinking,
                  label: profile.thinking,
                  configuration: profile.configurationHash,
                },
              ]
            : [],
        ),
      ),
    },
    {
      key: "benchmark",
      label: "Benchmark",
      options: uniqueOptions(
        runs.map((run) => {
          const value = run.definitions?.benchmark?.id ?? run.contract;
          return { value, label: value, configuration: run.runId };
        }),
      ),
    },
    {
      key: "taskFamily",
      label: "Task family",
      options: uniqueOptions(
        state.trials
          .filter((trial) => allowedRuns.has(trial.runId))
          .map((trial) => ({
            value: taskFamily(trial.taskId),
            label: taskFamily(trial.taskId),
            configuration: trial.taskId,
          })),
      ),
    },
  ];
  const panel = document.querySelector("#filter-all");
  panel.replaceChildren();
  const active = categories.find((category) => category.key === state.filterCategory);
  // One panel at a time: the value list replaces the category list, so the
  // popover never needs to grow wider than the viewport.
  if (active) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "filter-back";
    back.textContent = `‹ ${active.label}`;
    back.addEventListener("click", () => {
      state.filterCategory = null;
      buildFilterMenus(rows);
    });
    const submenu = document.createElement("div");
    submenu.className = "filter-submenu";
    submenu.setAttribute("role", "menu");
    for (const item of active.options) filterOption(submenu, active.key, item);
    panel.append(back, submenu);
  } else {
    const categoryMenu = document.createElement("div");
    categoryMenu.className = "filter-categories";
    for (const category of categories) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter-category";
      const count = selectedValues(category.key).size;
      const label = document.createElement("span");
      label.textContent = category.label;
      const detail = document.createElement("span");
      detail.textContent = count ? `${count}  ›` : "›";
      button.append(label, detail);
      button.addEventListener("click", () => {
        state.filterCategory = category.key;
        buildFilterMenus(rows);
      });
      categoryMenu.append(button);
    }
    panel.append(categoryMenu);
  }
  repositionFilterPopover();
}
async function load() {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not support gzip streams. Use a current browser.");
  }
  setStatus("loading", "Loading the latest dataset index…");
  setLoader("Loading benchmark results…", 4, "Reading the dataset index");
  const [indexResponse, viewsResponse] = await Promise.all([
    fetch(`${DATASET_ROOT}dataset-index.json`, { cache: "no-store" }),
    fetch(`${DATASET_ROOT}views.json`, { cache: "no-store" }),
  ]);
  if (!indexResponse.ok) throw new Error(`Dataset index: HTTP ${indexResponse.status}`);
  if (!viewsResponse.ok) throw new Error(`Dataset views: HTTP ${viewsResponse.status}`);
  const [indexText, viewsData] = await Promise.all([
    indexResponse.text(),
    viewsResponse.json(),
  ]);
  const index = JSON.parse(indexText);
  setViewsData(viewsData);
  if (!Array.isArray(index.runs)) throw new Error("Dataset index has no runs");
  const jobs = index.runs.flatMap((run) =>
    ["profiles", "trials", "rounds", "tool-calls"].map((table) => ({
      table,
      runId: run.runId,
      file: run.files[table],
    })),
  );
  setLoader("Loading benchmark results…", 10, `0 of ${jobs.length} result shards`);
  let loaded = 0;
  const groups = await Promise.all(
    jobs.map((job) =>
      fetchGzipJsonLines(job.file, `${job.runId}/${job.table}`, () => {
        loaded += 1;
        // Shards dominate the wait, so they own most of the bar.
        setLoader(
          "Loading benchmark results…",
          10 + (90 * loaded) / jobs.length,
          `${loaded} of ${jobs.length} result shards`,
        );
        setStatus("loading", `Loading data shards… ${loaded}/${jobs.length}`);
      }).then((rows) => ({ table: job.table, rows })),
    ),
  );
  state.index = index;
  for (const group of groups) {
    const key = group.table === "tool-calls" ? "toolCalls" : group.table;
    state[key].push(...group.rows);
  }
  const revision = (await sha256(new TextEncoder().encode(indexText))).slice(0, 10);
  const observations = state.trials.length.toLocaleString();
  document.querySelector("#revision").textContent = revision;
  document.querySelector("#freshness").textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  document.querySelector("#observation-total").textContent = observations;
  setStatus(
    "ready",
    `Live dataset loaded · ${index.runs.length} run${index.runs.length === 1 ? "" : "s"} · ${observations} observations`,
  );
  hideLoader();
  render();
  // A shared link can point straight at a card.
  const initialCard = new URLSearchParams(location.search).get("card");
  if (initialCard) {
    restoringCard = true;
    try {
      openCard(initialCard);
    } finally {
      restoringCard = false;
    }
  }
  syncUrl();
}

let filterPopoverTrigger = null;
let filterPopoverMenu = null;
let filterPopoverColumn = /** @type {string | null} */ (null);

/**
 * Grid.js recreates header buttons on every table render, so the anchor is
 * resolved from the column id again instead of a stale element.
 */
function popoverAnchor() {
  if (!filterPopoverColumn) return filterPopoverTrigger;
  return document.querySelector(
    `.gridjs-th[data-column-id="${filterPopoverColumn}"] .column-filter`,
  );
}

/** Anchor the open popover under its trigger, kept inside the viewport. */
function repositionFilterPopover() {
  const menu = filterPopoverMenu;
  if (!menu?.matches(":popover-open")) return;
  const anchor = popoverAnchor();
  // A detached anchor has a zero rect, which would throw the menu into a corner.
  if (!anchor?.isConnected) return;
  menu.style.maxHeight = `${Math.max(120, Math.min(560, innerHeight - 24))}px`;
  const box = menu.getBoundingClientRect();
  const position = popoverPosition(
    anchor.getBoundingClientRect(),
    { width: innerWidth, height: innerHeight },
    { width: box.width, height: box.height },
  );
  menu.style.left = `${position.left}px`;
  menu.style.top = `${position.top}px`;
}

function placeFilterPopover(button, menu, column = null) {
  filterPopoverTrigger = button;
  filterPopoverMenu = menu;
  filterPopoverColumn = column;
}

/**
 * Add the filter button Grid.js does not render. Grid.js builds headers
 * asynchronously, so a mutation observer re-checks whenever they change.
 */
function ensureHeaderControls() {
  const host = document.querySelector("#results-grid");
  if (!host?.querySelector(".gridjs-th:not([data-header-controls])")) return;
  addHeaderControls(host);
}

function addHeaderControls(host) {
  for (const th of host.querySelectorAll(".gridjs-th")) {
    const column = COLUMN_BY_ID.get(th.dataset.columnId);
    if (!column) continue;
    th.dataset.headerControls = "true";
    th.title = column.tooltip;
    if (!column.range && !column.detail.filter) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "column-filter";
    button.title = column.range ? `Filter by ${column.name} range` : `Filter by ${column.name}`;
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("column-filter-active", isColumnFiltered(column));
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M4 6h16M7 12h10M10 18h4");
    icon.append(path);
    button.append(icon);
    button.addEventListener("click", (event) => {
      // The header itself toggles sorting, so the button stops the event.
      event.stopPropagation();
      event.preventDefault();
      openColumnFilter(button, column);
    });
    button.addEventListener("keydown", (event) => event.stopPropagation());
    th.append(button);
  }
}

function isColumnFiltered(column) {
  if (column.range) return state.rangeFilters.has(column.id);
  return selectedValues(column.detail.filter.name).size > 0;
}

/** Open the shared filter menu drilled into one column, or its range popover. */
function openColumnFilter(button, column) {
  const menu = document.querySelector(column.range ? "#range-filter" : "#filter-all");
  // The anchor is registered before anything renders, so every later
  // reposition already knows which header to follow.
  placeFilterPopover(button, menu, column.id);
  if (!column.range) {
    state.filterCategory = column.detail.filter.name;
    buildFilterMenus(state.allRows);
    menu.showPopover();
    repositionFilterPopover();
    return;
  }
  state.rangeColumn = column.id;
  const current = state.rangeFilters.get(column.id);
  document.querySelector("#range-filter-title").textContent = `Filter by ${column.name}`;
  document.querySelector("#range-filter-min").value = current?.min ?? "";
  document.querySelector("#range-filter-max").value = current?.max ?? "";
  menu.showPopover();
  repositionFilterPopover();
}

/** Read a numeric input, treating an empty field as no bound. */
function rangeBound(selector) {
  const raw = document.querySelector(selector).value.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Numeric range filters narrow the table only, as chosen for this view. */
function matchesRanges(row) {
  for (const [id, range] of state.rangeFilters) {
    const column = COLUMN_BY_ID.get(id);
    const value = column.range.value(row);
    if (value == null) return false;
    if (range.min != null && value < range.min) return false;
    if (range.max != null && value > range.max) return false;
  }
  return true;
}

/** Chips that show and clear the active numeric range filters. */
function renderRangeFilters() {
  const host = document.querySelector("#range-filters");
  host.replaceChildren();
  for (const [id, range] of state.rangeFilters) {
    const column = COLUMN_BY_ID.get(id);
    const unit = column.range.unit;
    const chip = document.createElement("span");
    chip.className = "active-filter";
    const key = document.createElement("b");
    key.textContent = column.name;
    const label = document.createElement("span");
    const lower =
      range.min == null ? "−∞" : `${formatNumber(range.min, column.range.decimals)}${unit}`;
    const upper =
      range.max == null ? "∞" : `${formatNumber(range.max, column.range.decimals)}${unit}`;
    label.textContent = `${lower} – ${upper}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${column.name} range filter`);
    remove.addEventListener("click", () => {
      state.rangeFilters.delete(id);
      render();
    });
    chip.append(key, label, remove);
    host.append(chip);
  }
}

document.querySelector("#range-filter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const column = state.rangeColumn;
  if (column) {
    const min = rangeBound("#range-filter-min");
    const max = rangeBound("#range-filter-max");
    if (min == null && max == null) state.rangeFilters.delete(column);
    else state.rangeFilters.set(column, { min, max });
  }
  document.querySelector("#range-filter").hidePopover();
  render();
});

document.querySelector("#range-filter-clear").addEventListener("click", () => {
  if (state.rangeColumn) state.rangeFilters.delete(state.rangeColumn);
  document.querySelector("#range-filter").hidePopover();
  render();
});

for (const button of document.querySelectorAll(".filter-button")) {
  button.addEventListener("click", () => {
    placeFilterPopover(button, document.querySelector("#filter-all"));
    state.filterCategory = null;
    buildFilterMenus(state.allRows);
    requestAnimationFrame(repositionFilterPopover);
  });
}

new MutationObserver(ensureHeaderControls).observe(document.querySelector("#results-grid"), {
  childList: true,
  subtree: true,
});

closeOnOutsideClick(document.querySelector("#cell-details"));
document.querySelector("#cell-details").addEventListener("close", () => setCard(null));

document.querySelector("#clear-selection").addEventListener("click", () => {
  state.selected.clear();
  render();
  syncUrl(true);
});

document.querySelector("#reset-filters").addEventListener("click", () => {
  for (const values of state.filters.values()) values.clear();
  state.rangeFilters.clear();
  state.selected.clear();
  render();
  syncUrl();
});

/** True when two filter maps describe the same view. */
function sameFilters(left, right) {
  for (const name of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(name) ?? new Set();
    const b = right.get(name) ?? new Set();
    if (a.size !== b.size || [...a].some((value) => !b.has(value))) return false;
  }
  return true;
}

const sameSelection = (left, right) =>
  left.size === right.size && [...left].every((value) => right.has(value));

window.addEventListener("popstate", () => {
  const controls = parseExplorerControls(location.search);
  const params = new URLSearchParams(location.search);
  const filters = new Map(
    Object.entries(controls.filters).map(([name, values]) => [name, new Set(values)]),
  );
  const selected = new Set(params.getAll("select"));
  // Back and forward usually only move the card. Rebuilding the page for that
  // makes the return crawl next to the instant click that opened it, so the
  // page is redrawn only when the selection or the filters really changed.
  if (!sameSelection(selected, state.selected) || !sameFilters(filters, state.filters)) {
    state.filters = filters;
    state.selected = selected;
    render();
  }
  // The card is part of the path too, so Back returns to the previous one.
  restoringCard = true;
  try {
    openCard(params.get("card"));
  } finally {
    restoringCard = false;
  }
});

load().catch((error) => {
  console.error(error);
  hideLoader();
  setStatus("error", `Could not load the public dataset. ${error.message}`);
  document.querySelector("#error-help").hidden = false;
});
