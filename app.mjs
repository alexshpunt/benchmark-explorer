import {
  aggregateLeaderboard,
  filterSnapshotRunRows,
  canonicalModelFamily,
  modelRouteIdentity,
  modelRouteLabel,
  normalizeColumnLayout,
  latestHarnessConfigurations,
  expandToolCounts,
  explorerSearch,
  parseExplorerControls,
  parseExplorerState,
  resolveHarnessVersion,
  setViewsData,
  validateDatasetSnapshot,
  verifyPublishedBytes,
} from "./core.mjs";
import { createFilters } from "./modules/filters.mjs";
import { createLeaderboard, renderDataTable } from "./modules/leaderboard.mjs";
import { h } from "./vendor/gridjs-6.2.0.mjs";
import { createDetails } from "./modules/details.mjs";
import { createComparison } from "./modules/comparison.mjs";
import { createMatrix } from "./modules/matrix.mjs";
import { createPareto } from "./modules/pareto.mjs";
import { createSummaryLeaderboards } from "./modules/summary-leaderboards.mjs";
import { baselineHarnessScores } from "./modules/scoring.mjs";

/** Public home of the accepted data, and the base for every provenance link. */
const DATASET_PAGE = "https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark";
const BASELINE_HARNESS = "baseline-agent";
/** Comparison series colours, resolved per theme by styles/comparison.css. */
const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const FILTER_LABELS = {
  model: "Model",
  agent: "Agent",
  harness: "Harness",
  harnessVersion: "Harness version",
  reasoning: "Thinking",
  benchmark: "Benchmark",
  taskFamily: "Task family",
};
const LEADERBOARD_LAYOUT_KEY = "benchmark-explorer:leaderboard-layout:v1";
const MATRIX_METRIC_KEY = "benchmark-explorer:matrix-metric:v1";
const MATRIX_METRIC_IDS = new Set([
  "score",
  "firstExact",
  "avgCost",
  "avgTokens",
  "qualityPerDollar",
]);

function readPreference(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The Explorer still works when storage is disabled or unavailable.
  }
}

const initialControls = parseExplorerControls(location.search);
const initialRoute = parseExplorerState(location.search);
const initialParams = new URLSearchParams(location.search);
const storedMatrixMetric = readPreference(MATRIX_METRIC_KEY);
const initialMatrixMetric = initialParams.has("metric")
  ? initialControls.matrixMetric
  : MATRIX_METRIC_IDS.has(storedMatrixMetric)
    ? storedMatrixMetric
    : "score";
const state = {
  index: null,
  snapshot: null,
  views: null,
  revision: null,
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
  /** Latest accepted run rows used by compact matrix columns. */
  compactConfigurations: [],
  paretoCells: [],
  /** Matrix cells retained by key so a hidden compact selection keeps its meaning. */
  matrixCellCache: new Map(),
  /** Numeric range filters. They narrow the table only, not the whole page. */
  rangeFilters: new Map(),
  /** Column whose range popover is currently open. @type {string | null} */
  rangeColumn: null,
  filterCategory: /** @type {string | null} */ (null),
  /** Matrix value shown at each model-route and harness intersection. */
  matrixMetric: initialMatrixMetric,
  paretoX: initialParams.get("paretoX") === "tokens" ? "tokens" : "cost",
  baselineScores: null,
  matrixBaselineOnly: initialParams.get("matrixRoutes") !== "all",

  /** Harness families whose individual versions are visible in the matrix. */
  expandedHarnesses: new Set(initialControls.expandedHarnesses),
  matrixGroups: new Set(
    ["model", "harness", "extension"].filter((value) => !initialParams.getAll("ungroup").includes(value)),
  ),
  expandedModels: new Set(initialParams.getAll("expandModel")),
  expandedMatrixGroups: new Set(initialParams.getAll("expandGroup")),
  /** Browser-persisted leaderboard column visibility and order. */
  columnLayout: null,
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
      matrixMetric: state.matrixMetric,
      expandedHarnesses: [...state.expandedHarnesses],
      filters: Object.fromEntries(
        [...state.filters]
          .filter(([, values]) => values.size > 0)
          .map(([name, values]) => [name, [...values]]),
      ),
    },
  );
  const params = new URLSearchParams(search);
  for (const group of ["model", "harness", "extension"])
    if (!state.matrixGroups.has(group)) params.append("ungroup", group);
  for (const model of [...state.expandedModels].sort()) params.append("expandModel", model);
  for (const group of [...state.expandedMatrixGroups].sort()) params.append("expandGroup", group);
  if (!state.matrixBaselineOnly) params.set("matrixRoutes", "all");

  for (const selection of state.selected) params.append("select", selection);
  if (state.paretoX !== "cost") params.set("paretoX", state.paretoX);
  if (initialParams.get("testRuns") === "50") params.set("testRuns", "50");
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
    row.provider ?? "unknown",
    row.harnessFamily,
    row.harnessVersion ?? "",
    row.thinking ?? "",
    row.runId ?? "",
  ].join("|");
}

/** Rows behind a card scope: "all", one configuration, or every harness. */
function scopeOf(token) {
  if (!token || token === "all") return state.configurations;
  const [model, provider, harness, version = "", thinking = "", runId = ""] = token.split("|");
  const rows = runId ? (state.snapshot?.runRows?.all ?? []) : state.configurations;
  return rows.filter(
    (row) =>
      canonicalModelFamily(row.modelFamily) === model &&
      (row.provider ?? "unknown") === provider &&
      (harness === "*" || row.harnessFamily === harness) &&
      (version === "" || (row.harnessVersion ?? "") === version) &&
      (thinking === "" || (row.thinking ?? "") === thinking) &&
      (runId === "" || row.runId === runId),
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
  const runIds = new Set(rows.map((row) => row.runId).filter(Boolean));
  return [
    canonicalModelFamily(first.modelFamily),
    first.provider ?? "unknown",
    harness,
    first.harnessVersion ?? "",
    "",
    runIds.size === 1 ? [...runIds][0] : "",
  ].join("|");
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
  if (kind === "run") {
    openRunDetails(payload);
    return;
  }
  if (kind === "config") {
    openConfigurationDetails(scopeOf(payload));
    return;
  }
  if (kind === "metric") {
    const boundary = payload.indexOf("|");
    const columnId = boundary < 0 ? payload : payload.slice(0, boundary);
    const token = boundary < 0 ? "" : payload.slice(boundary + 1);
    const [row] = scopeOf(token);
    const index = row ? state.rows.indexOf(row) : -1;
    if (row && index >= 0) openCellDetails(row, index, columnId);
    else dialog.close();
    return;
  }
  const boundary = payload.indexOf("|");
  const name = boundary < 0 ? payload : payload.slice(0, boundary);
  const scope = boundary < 0 ? "all" : payload.slice(boundary + 1);
  if (kind === "model") openModelDetails(`${name}\t${scope}`);
  else if (kind === "harness") {
    const [family, version = ""] = name.split("@");
    const badgeVersion = state.views?.badges?.harnessFamily?.[family]?.harnessVersion;
    const resolvedVersion =
      version === "latest"
        ? badgeVersion
        : resolveHarnessVersion(state.configurations, family, version || null);
    openHarnessDetails(family, resolvedVersion);
  } else if (kind === "family") openTaskFamilyDetails(name, scopeOf(scope));
  else if (kind === "task") openTaskDetails(name, scopeOf(scope));
  else if (kind === "tool") openToolDetails(name, scopeOf(scope), scope !== "all");
  else dialog.close();
}

function syncUrl(push = false) {
  const search = currentSearch();
  history[push ? "pushState" : "replaceState"](null, "", (search || location.pathname) + location.hash);
  window.parent.postMessage({ queryString: search }, "https://huggingface.co");
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

const { matrixCells, groupedMatrixCells, renderMatrix, rowsForCell, cellKeyFromRow, toggleSelection } = createMatrix(state, {
  mean, COLORS, selectedValues, syncUrl, render, renderMatrixState,
  openModelDetails: (...args) => openModelDetails(...args),
  openHarnessDetails: (...args) => openHarnessDetails(...args),
});

/** Percentage text with one decimal place, e.g. 0.9967 becomes "99.7%". */
function percentText(value) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

const pareto = createPareto(state, toggleSelection, render, syncUrl);
const { COLUMN_BY_ID, DEFAULT_COLUMN_IDS, DEFAULT_COLUMN_LAYOUT, REQUIRED_COLUMN_IDS, saveColumnLayout,
  clearColumnDropIndicators, showColumnDropIndicator, moveLeaderboardColumn, applyLeaderboardColumnLayout,
  renderColumnSettings, renderResultsTable, addOverflowTitles } = createLeaderboard(state, {
  mean, percentText, readPreference, writePreference, LEADERBOARD_LAYOUT_KEY,
  openModelDetails: (...args) => openModelDetails(...args),
  openHarnessDetails: (...args) => openHarnessDetails(...args),
  openAgentDetails: (...args) => openAgentDetails(...args),
  openThinkingDetails: (...args) => openThinkingDetails(...args),
  openCellDetails: (...args) => openCellDetails(...args),
  ensureLeaderboardTable: (...args) => ensureLeaderboardTable(...args),
  getLeaderboardTableObserver: () => getLeaderboardTableObserver(),
});

const runEvidenceCache = new Map();

/** Load and verify the immutable detail package for one opened run. */
async function loadRunEvidence(runId) {
  if (runEvidenceCache.has(runId)) return runEvidenceCache.get(runId);
  const pending = (async () => {
    const file = state.index?.explorerDetails?.[runId];
    if (!file || !state.revision) throw Error(`Unknown run ${runId}`);
    const url = `${DATASET_PAGE}/resolve/${state.revision}/${file.path}`;
    const response = await fetch(url);
    if (!response.ok) throw Error(`${file.path}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await verifyPublishedBytes(bytes, file.sha256);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const evidence = JSON.parse(await new Response(stream).text());
    if (
      evidence?.schemaVersion !== 1 ||
      evidence.runId !== runId ||
      !Array.isArray(evidence.profiles) ||
      !Array.isArray(evidence.trials) ||
      !Array.isArray(evidence.rounds) ||
      !Array.isArray(evidence.toolCalls)
    ) {
      throw Error(`Invalid run detail ${runId}`);
    }
    return evidence;
  })();
  runEvidenceCache.set(runId, pending);
  try {
    return await pending;
  } catch (error) {
    runEvidenceCache.delete(runId);
    throw error;
  }
}

const { openConfigurationDetails, openRunDetails, openModelDetails, openAgentDetails, openThinkingDetails,
  openHarnessDetails, openTaskFamilyDetails, openTaskDetails, openToolDetails,
  openCellDetails, familyScore, formatNumber, closeOnOutsideClick } = createDetails(state, {
  DATASET_PAGE, percentText, mean, scopeToken, configToken, setCard,
  selectedValues, activeFilters, render, syncUrl, rowsForCell, cellKeyFromRow,
  COLUMN_BY_ID, loadRunEvidence, pooledFamilyScore: (...args) => pooledFamilyScore(...args),
});

const renderSummaryLeaderboards = createSummaryLeaderboards(openConfigurationDetails);

const { renderComparison, pooledFamilyScore } = createComparison(state, {
  mean, COLORS, rowsForCell, cellKeyFromRow, familyScore, activeFilters,
  openConfigurationDetails, openTaskFamilyDetails, openToolDetails,
});

const { renderActiveFilters, buildFilterMenus, repositionFilterPopover,
  placeFilterPopover, ensureLeaderboardTable, getLeaderboardTableObserver,
  matchesRanges, renderRangeFilters } = createFilters(state, {
  FILTER_LABELS, selectedValues, render, syncUrl, renderMatrixState, matrixCells,
  COLUMN_BY_ID, clearColumnDropIndicators, showColumnDropIndicator,
  moveLeaderboardColumn, applyLeaderboardColumnLayout, addOverflowTitles, formatNumber,
});

function renderMatrixState(cells) {
  document.querySelector("#matrix-baseline-only").checked = state.matrixBaselineOnly;

  for (const cell of cells) state.matrixCellCache.set(cell.key, cell);
  const visible = groupedMatrixCells(cells);
  const modelRoutes = new Set(visible.map((cell) =>
    state.matrixGroups.has("model") ? cell.model.split("\t")[0] : cell.model,
  )).size;
  const harnessColumns = new Set(
    visible.filter((cell) => !cell.overall).map((cell) => cell.columnKey),
  ).size;
  document.querySelector("#summary-context").textContent =
    `${modelRoutes} ${state.matrixGroups.has("model") ? "model families" : "model routes"} · ${harnessColumns} harness columns`;
  for (const cell of visible) state.matrixCellCache.set(cell.key, cell);
  renderMatrix(visible);
  renderComparison(cells);
}
function withAcceptanceDates(rows) {
  const dates = new Map(state.snapshot.acceptedRuns.map((run) => [run.runId, run.acceptedAt]));
  return rows.map((row) => ({ ...row, acceptedAt: row.runIds
    .map((runId) => dates.get(runId)).filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null }));
}
function render() {
  const configurationRows = withAcceptanceDates(aggregateLeaderboard(
    state.index,
    state.profiles,
    state.trials,
    state.rounds,
    activeFilters(),
  ));
  const runRows = filterSnapshotRunRows(state.snapshot, activeFilters());
  state.scoringRows = runRows;
  renderSummaryLeaderboards(runRows, state.snapshot.runRows.all);
  const compactRows = latestHarnessConfigurations(
    runRows,
    state.index.runs.map((run) => run.runId),
  );
  state.allRows = aggregateLeaderboard(state.index, state.profiles, state.trials, state.rounds, {});
  state.configurations = configurationRows.toSorted((left, right) =>
    Number(right.fullBenchmark) - Number(left.fullBenchmark) || right.score - left.score);
  state.compactConfigurations = compactRows;
  state.paretoCells = matrixCells(state.configurations, state.compactConfigurations, new Set());
  state.matrixCellCache = new Map(state.paretoCells.map((cell) => [cell.key, cell]));
  const cells = matrixCells(state.configurations, state.compactConfigurations, state.expandedHarnesses);
  renderMatrixState(cells);
  pareto.render(state.paretoCells);
  renderComparison(cells);
  renderResultsTable(configurationRows.filter(matchesRanges));
  renderRangeFilters();
  buildFilterMenus(state.allRows);
  renderActiveFilters();
  document.querySelector("#reset-filters").hidden = ![...state.filters.values()].some(
    (values) => values.size,
  );
}

function renderRecentRuns() {
  document.querySelector("#header-run-count").textContent = state.index.runs.length.toLocaleString();
  const list = document.querySelector("#recent-runs");
  const profiles = new Map();
  for (const profile of state.profiles) {
    if (!profiles.has(profile.runId)) profiles.set(profile.runId, profile);
  }
  list.replaceChildren(...state.snapshot.recentRuns.map((run) => {
    const profile = profiles.get(run.runId);
    const item = document.createElement("li");
    const link = document.createElement("a");
    const url = new URL(currentSearch() || location.pathname, location.href);
    url.searchParams.set("card", `run:${run.runId}`);
    link.href = url.href;
    const score = document.createElement("strong");
    score.className = "recent-score";
    score.textContent = run.score == null ? "—" : (run.score * 100).toFixed(1);
    score.title = run.score == null ? "No full-run score" : "Median score of full configurations";
    const firstDivider = document.createElement("span");
    firstDivider.className = "recent-divider";
    firstDivider.setAttribute("aria-hidden", "true");
    const date = document.createElement("time");
    date.dateTime = run.acceptedAt;
    date.textContent = new Intl.DateTimeFormat("en", {
      month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
    }).format(new Date(run.acceptedAt));
    date.title = `Added to the dataset ${run.acceptedAt}`;
    const secondDivider = firstDivider.cloneNode();
    const label = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = profile
      ? `${profile.modelFamily ?? profile.modelId ?? "Model"} · ${profile.harnessFamily ?? profile.harnessId ?? "Harness"}`
      : run.runId;
    const id = document.createElement("small");
    id.textContent = run.runId;
    if (run.submittedBy?.accountId) id.textContent += ` · by @${run.submittedBy.accountId}`;
    link.title = `${name.textContent} · ${run.runId}`;
    label.className = "recent-identity";
    label.append(name, id);
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";
    link.append(score, firstDivider, date, secondDivider, label, arrow);
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openRunDetails(run.runId);
    });
    item.append(link);
    return item;
  }));
}
let additionsGrid;
function renderAllAdditions() {
  const profiles = new Map();
  for (const profile of state.profiles) if (!profiles.has(profile.runId)) profiles.set(profile.runId, profile);
  const rows = state.snapshot.acceptedRuns.map((run) => ({ ...run, profile: profiles.get(run.runId) }));
  const columns = [
    { id: "dateAdded", name: "Date added", sort: false, cell: (row) => new Intl.DateTimeFormat("en", {
      month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
    }).format(new Date(row.acceptedAt)) },
    { id: "score", name: "Score", sort: false,
      cell: (row) => row.score == null ? "—" : Number((row.score * 100).toFixed(1)) },
    { id: "model", name: "Provider / model", sort: false,
      cell: (row) => `${row.profile?.provider ?? "unknown"} / ${row.profile?.modelFamily ?? row.profile?.modelId ?? "Model"}` },
    { id: "agent", name: "Agent / harness", sort: false,
      cell: (row) => `${row.profile?.agentFamily ?? "Agent"} / ${row.profile?.harnessFamily ?? row.profile?.harnessId ?? "Harness"}` },
    { id: "run", name: "Run", sort: false, cell: (row) => row.runId },
  ];
  additionsGrid?.destroy();
  const host = document.querySelector("#additions-grid");
  host.replaceChildren();
  additionsGrid = renderDataTable(host, rows, columns, {
    className: "results-table",
    onCell: ({ cell, row }) => h("button", { type: "button", className: "cell-detail",
      title: `Open ${row.runId}`, onClick: () => {
        document.querySelector("#additions-dialog").close();
        openRunDetails(row.runId);
      } }, String(cell)),
  });
}

const SNAPSHOT_CACHE = "benchmark-explorer:snapshots:v1";
const SNAPSHOT_MANIFEST_KEY = "benchmark-explorer:snapshot-manifest:v1";
let initialViewRestored = false;

document.querySelector("#view-all-additions").addEventListener("click", () => {
  renderAllAdditions();
  document.querySelector("#additions-dialog").showModal();
});
document.querySelector("#close-additions").addEventListener("click", () =>
  document.querySelector("#additions-dialog").close());

function validSnapshotManifest(manifest) {
  return manifest?.schemaVersion === 1 && /^[a-f0-9]{40}$/.test(manifest.revision) &&
    /^snapshots\/snapshot\.[a-f0-9]{64}\.json\.gz$/.test(manifest.file) &&
    manifest.file === `snapshots/snapshot.${manifest.sha256}.json.gz`;
}

async function parseSnapshot(manifest, bytes) {
  await verifyPublishedBytes(bytes, manifest.sha256);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const snapshot = JSON.parse(await new Response(stream).text());
  if (snapshot.schemaVersion !== 1 || snapshot.revision !== manifest.revision ||
      !Array.isArray(snapshot.runRows?.all) || !Array.isArray(snapshot.acceptedRuns) ||
      !Array.isArray(snapshot.recentRuns) ||
      !Array.isArray(snapshot.trials) || snapshot.trials.length !== manifest.trials ||
      !Array.isArray(snapshot.toolCounts))
    throw Error("Snapshot contents do not match the manifest");
  validateDatasetSnapshot(snapshot.index, snapshot.views);
  return snapshot;
}

function installSnapshot(snapshot, freshness) {
  setViewsData(snapshot.views);
  state.snapshot = snapshot;
  state.index = snapshot.index;
  state.views = snapshot.views;
  state.revision = snapshot.revision;
  state.profiles = snapshot.profiles;
  state.trials = snapshot.trials;
  state.rounds = snapshot.rounds;
  state.toolCalls = expandToolCounts(snapshot.toolCounts);
  const acceptedRunIds = snapshot.index.runs.map((run) => run.runId);
  state.baselineScores = baselineHarnessScores(snapshot.runRows.all, acceptedRunIds, BASELINE_HARNESS);
  renderRecentRuns();
  hideLoader();
  render();
  setStatus("ready", `${freshness} · Dataset ${snapshot.revision.slice(0, 8)}`);
  if (!initialViewRestored) {
    initialViewRestored = true;
    const initialCard = new URLSearchParams(location.search).get("card");
    if (initialCard) {
      restoringCard = true;
      try { openCard(initialCard); } finally { restoringCard = false; }
    }
    syncUrl();
    if (location.hash === "#matrix-title") document.querySelector("#matrix-title").scrollIntoView();
  }
}

async function cachedSnapshot() {
  if (!("caches" in globalThis)) return null;
  const manifest = readPreference(SNAPSHOT_MANIFEST_KEY);
  if (!validSnapshotManifest(manifest)) return null;
  const response = await (await caches.open(SNAPSHOT_CACHE)).match(`./${manifest.file}`);
  if (!response) return null;
  return { manifest, snapshot: await parseSnapshot(manifest, await response.arrayBuffer()) };
}

async function load() {
  if (typeof DecompressionStream === "undefined")
    throw new Error("This browser does not support gzip streams. Use a current browser.");
  setLoader("Loading benchmark results…", 5, "Checking the saved snapshot");
  const saved = await cachedSnapshot().catch(() => null);
  if (saved) installSnapshot(saved.snapshot, "Saved snapshot; checking freshness");

  const manifestResponse = await fetch("./snapshot-manifest.json", { cache: "no-store" });
  if (!manifestResponse.ok) throw Error(`Snapshot manifest: HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  if (!validSnapshotManifest(manifest)) throw Error("Unsupported snapshot manifest");
  if (saved?.manifest.sha256 === manifest.sha256) {
    setStatus("ready", `Published snapshot · Dataset ${manifest.revision.slice(0, 8)}`);
    return;
  }

  setLoader("Loading benchmark results…", 35, "Downloading the current snapshot");
  const response = await fetch(`./${manifest.file}`);
  if (!response.ok) throw Error(`Snapshot: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const snapshot = await parseSnapshot(manifest, bytes);
  if ("caches" in globalThis) {
    const cache = await caches.open(SNAPSHOT_CACHE);
    await cache.put(`./${manifest.file}`, new Response(bytes));
    writePreference(SNAPSHOT_MANIFEST_KEY, manifest);
  }
  installSnapshot(snapshot, "Published snapshot");
}

document.querySelectorAll("dialog").forEach(closeOnOutsideClick);

document.addEventListener("pointerdown", (event) => {
  for (const overlay of document.querySelectorAll("details[data-overlay][open]")) {
    if (!overlay.contains(event.target)) overlay.removeAttribute("open");
  }
});
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
  const expandedHarnesses = new Set(controls.expandedHarnesses);
  const matrixGroups = new Set(["model", "harness", "extension"].filter((value) => !params.getAll("ungroup").includes(value)));
  const expandedModels = new Set(params.getAll("expandModel"));
  const expandedMatrixGroups = new Set(params.getAll("expandGroup"));
  const matrixMetric = controls.matrixMetric;
  const matrixBaselineOnly = params.get("matrixRoutes") !== "all";
  const routesChanged = matrixBaselineOnly !== state.matrixBaselineOnly;
  state.matrixBaselineOnly = matrixBaselineOnly;

  const matrixMetricChanged = matrixMetric !== state.matrixMetric;
  const expansionChanged = !sameSelection(expandedHarnesses, state.expandedHarnesses) ||
    !sameSelection(matrixGroups, state.matrixGroups) ||
    !sameSelection(expandedModels, state.expandedModels) ||
    !sameSelection(expandedMatrixGroups, state.expandedMatrixGroups);
  // Back and forward usually move only the card or harness expansion. Rebuild
  // all views only when data-bearing controls changed; expansion redraws just
  // the matrix and its comparison panel.
  const dataChanged =
    matrixMetricChanged ||
    !sameSelection(selected, state.selected) ||
    !sameFilters(filters, state.filters);
  if (dataChanged) {
    state.filters = filters;
    state.selected = selected;
    state.matrixMetric = matrixMetric;
    state.expandedHarnesses = expandedHarnesses;
    state.matrixGroups = matrixGroups;
    state.expandedModels = expandedModels;
    state.expandedMatrixGroups = expandedMatrixGroups;
    render();
  } else if (expansionChanged || routesChanged) {
    state.expandedHarnesses = expandedHarnesses;
    state.matrixGroups = matrixGroups;
    state.expandedModels = expandedModels;
    state.expandedMatrixGroups = expandedMatrixGroups;
    renderMatrixState(
      matrixCells(state.configurations, state.compactConfigurations, state.expandedHarnesses),
    );
    buildFilterMenus(state.allRows);
  }
  // The card is part of the path too, so Back returns to the previous one.
  restoringCard = true;
  try {
    openCard(params.get("card"));
  } finally {
    restoringCard = false;
  }
});

document.querySelector("#matrix-baseline-only").addEventListener("change", (event) => {
  state.matrixBaselineOnly = event.target.checked;
  renderMatrixState(matrixCells(state.configurations, state.compactConfigurations, state.expandedHarnesses));
  syncUrl();
});

document.querySelector("#matrix-metric").addEventListener("change", (event) => {
  state.matrixMetric = MATRIX_METRIC_IDS.has(event.target.value) ? event.target.value : "score";
  writePreference(MATRIX_METRIC_KEY, state.matrixMetric);
  render();
  syncUrl();
});

document.querySelector("#reset-columns").addEventListener("click", () => {
  state.columnLayout = normalizeColumnLayout(DEFAULT_COLUMN_IDS, DEFAULT_COLUMN_LAYOUT, REQUIRED_COLUMN_IDS);
  saveColumnLayout();
  renderColumnSettings();
  applyLeaderboardColumnLayout();
});

renderColumnSettings();

load().catch((error) => {
  console.error(error);
  hideLoader();
  setStatus("error", `${state.views ? "Run evidence stopped loading; published scores remain available" : "Could not load the public dataset"}. ${error.message}`);
  document.querySelector(".status-bar").hidden = false;
  document.querySelector("#error-help").hidden = false;
});
