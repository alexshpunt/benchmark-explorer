import {
  canonicalModelFamily, modelRouteIdentity,
  moveColumn, normalizeColumnLayout,
} from "../core.mjs";
import { Grid, h } from "../vendor/gridjs-6.2.0.mjs";

/** Optional leaderboard columns hidden until a reader enables them in Columns. */
export const DEFAULT_HIDDEN_IDS = [
  "trials", "provider", "harness", "harnessVersion", "thinking", "coverage",
  "firstExact(%)", "finalExact(%)", "recoveryGain", "avgSeconds", "avgCost($)", "avgTokens",
];

/** Create leaderboard columns, layout controls and table renderer. */
export function createLeaderboard(state, {
  mean, percentText, readPreference, writePreference, LEADERBOARD_LAYOUT_KEY,
  openModelDetails, openHarnessDetails, openAgentDetails, openThinkingDetails,
  openCellDetails, ensureLeaderboardTable, getLeaderboardTableObserver,
}) {
  let resultsGrid;
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
      cell: (_row, index) => index + 1,
      detail: {
        lines: [
          "Rank is positional: configurations are ordered by Score, best first, and rank reflects only the rows currently visible after filtering.",
        ],
        inputs: (_row, index) => [
          ["Rank", String(index + 1)],
          ["Visible configurations", String(state.rows.length)],
        ],
      },
    },
    {
      id: "score",
      name: "Score",
      tooltip: "Only complete benchmark runs receive a summary score. Partial runs remain visible in details.",
      cell: (row) => row.fullBenchmark ? Number((row.score * 100).toFixed(3)) : "—",
      range: { value: (row) => row.fullBenchmark ? row.score * 100 : null, decimals: 3, unit: "" },
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
      name: "Provider / model route / reasoning",
      tooltip: "Provider, model family and reasoning level. Select the route to inspect its sources.",
      cell: (row) => `${row.provider ?? "unknown"} / ${canonicalModelFamily(row.modelFamily)} / ${row.thinking ?? "—"}`,
      open: (row) => openModelDetails(modelRouteIdentity(row)),
      detail: {
        lines: [
          "Every accepted configuration recorded for this model route under the current filters, and how its Score is built from the observed tasks.",
        ],
        inputs: (row) => [
          ["Model family", canonicalModelFamily(row.modelFamily)],
          ["Provider", row.provider ?? "unknown"],
          ["Model version", row.modelVersion ?? "—"],
        ],
        identity: modelRouteIdentity,
        filter: { name: "model", value: (row) => canonicalModelFamily(row.modelFamily) },
      },
    },
    {
      id: "provider",
      name: "Provider",
      tooltip: "Inference provider used for this model route.",
      cell: (row) => row.provider ?? "unknown",
      detail: {
        lines: [
          "The provider is part of the primary model route because the same model family can behave differently through different serving paths.",
        ],
        inputs: (row) => [["Provider", row.provider ?? "unknown"]],
        identity: (row) => row.provider ?? "unknown",
        filter: { name: "provider", value: (row) => row.provider ?? "unknown" },
      },
    },
    {
      id: "agent",
      name: "Agent / harness / version",
      tooltip: "Agent, harness and published version. Select to inspect this configuration.",
      cell: (row) => `${row.agentFamily} / ${row.harnessFamily} / ${row.harnessVersion ?? "—"}`,
      open: (row) => openHarnessDetails(row.harnessFamily, row.harnessVersion),
      detail: {
        lines: [
          "The agent is the client that talked to the model. Comparing agents separates model quality from prompt and control-loop design.",
        ],
        inputs: (row) => [
          ["Agent version", row.agentVersion ?? "—"],
          ["Harness", row.harnessFamily],
          ["Harness version", row.harnessVersion ?? "—"],
        ],
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
      id: "totalCost($)",
      name: "Total cost ($)",
      tooltip: "Total observed model cost across trials. Missing values remain missing.",
      cell: (row) => (row.cost.observations ? Number(row.cost.total.toFixed(4)) : null),
      range: {
        value: (row) => (row.cost.observations ? row.cost.total : null),
        decimals: 4,
        unit: "$",
      },
      detail: {
        lines: [
          "Total reported model cost across trials. Providers that do not report cost leave those trials out of the total.",
        ],
        inputs: (row) => [
          ["Total cost", row.cost.observations ? `$${row.cost.total.toFixed(4)}` : "—"],
          ["Reported trials", `${row.cost.observations} of ${row.observations}`],
        ],
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
    {
      id: "totalTokens",
      name: "Total tokens",
      tooltip: "Total observed model tokens across trials. Missing values remain missing.",
      cell: (row) => (row.tokens.observations ? Math.round(row.tokens.total) : null),
      range: {
        value: (row) => (row.tokens.observations ? row.tokens.total : null),
        decimals: 0,
        unit: "tokens",
      },
      detail: {
        lines: [
          "Total reported tokens across trials, counting input, output and cache tokens where the provider reported them.",
        ],
        inputs: (row) => [
          [
            "Total tokens",
            row.tokens.observations ? Math.round(row.tokens.total).toLocaleString() : "—",
          ],
          ["Reported trials", `${row.tokens.observations} of ${row.observations}`],
        ],
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
  const DEFAULT_COLUMN_IDS = COLUMNS.map((column) => column.id);
  const DEFAULT_COLUMN_LAYOUT = { version: 1, order: DEFAULT_COLUMN_IDS, hidden: DEFAULT_HIDDEN_IDS };
  const REQUIRED_COLUMN_IDS = ["model"];
  state.columnLayout = normalizeColumnLayout(
    DEFAULT_COLUMN_IDS,
    readPreference(LEADERBOARD_LAYOUT_KEY) ?? DEFAULT_COLUMN_LAYOUT,
    REQUIRED_COLUMN_IDS,
  );

  function leaderboardColumns() {
    return state.columnLayout.order.map((id) => COLUMN_BY_ID.get(id)).filter(Boolean);
  }

  function saveColumnLayout() {
    state.columnLayout = normalizeColumnLayout(
      DEFAULT_COLUMN_IDS,
      state.columnLayout,
      REQUIRED_COLUMN_IDS,
    );
    writePreference(LEADERBOARD_LAYOUT_KEY, state.columnLayout);
  }

  function clearColumnDropIndicators() {
    for (const element of document.querySelectorAll(".column-drop-before, .column-drop-after")) {
      element.classList.remove("column-drop-before", "column-drop-after");
    }
  }

  function showColumnDropIndicator(element, after) {
    clearColumnDropIndicators();
    element.classList.add(after ? "column-drop-after" : "column-drop-before");
  }

  function reconcileElementOrder(parent, ordered) {
    const current = [...parent.children].filter((element) => ordered.includes(element));
    for (const [index, element] of ordered.entries()) {
      if (current[index] === element) continue;
      const previousIndex = current.indexOf(element);
      parent.insertBefore(element, current[index] ?? null);
      if (previousIndex >= 0) current.splice(previousIndex, 1);
      current.splice(index, 0, element);
    }
  }

  /** Apply browser column preferences to the existing Grid.js DOM without recreating the table. */
  function applyLeaderboardColumnLayout({ move = null, revealId = null, visibilityId = null } = {}) {
    const host = document.querySelector("#results-grid");
    const hidden = new Set(state.columnLayout.hidden);
    for (const row of host.querySelectorAll("thead tr, tbody tr")) {
      if (move) {
        const source = [...row.children].find((cell) => cell.dataset.columnId === move.sourceId);
        const target = [...row.children].find((cell) => cell.dataset.columnId === move.targetId);
        if (!source || !target) continue;
        row.insertBefore(source, move.after ? target.nextElementSibling : target);
        continue;
      }
      if (visibilityId) {
        const cell = [...row.children].find((child) => child.dataset.columnId === visibilityId);
        if (!cell) continue;
        cell.hidden = hidden.has(visibilityId);
        if (revealId && cell.tagName === "TH" && !cell.hidden) {
          cell.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 140,
            easing: "ease-out",
          });
        }
        continue;
      }
      const cells = new Map(
        [...row.children]
          .filter((cell) => cell.dataset.columnId)
          .map((cell) => [cell.dataset.columnId, cell]),
      );
      const ordered = state.columnLayout.order.map((id) => cells.get(id)).filter(Boolean);
      reconcileElementOrder(row, ordered);
      for (const [id, cell] of cells) {
        const shouldHide = hidden.has(id);
        if (cell.hidden !== shouldHide) cell.hidden = shouldHide;
      }
    }
    // Layout reconciliation is intentional; it must not schedule another full-table pass.
    getLeaderboardTableObserver()?.takeRecords();
  }

  function moveLeaderboardColumn(sourceId, targetId, after = false) {
    const order = moveColumn(state.columnLayout.order, sourceId, targetId, after);
    if (order.every((id, index) => id === state.columnLayout.order[index])) return;
    state.columnLayout = { ...state.columnLayout, order };
    saveColumnLayout();
    const move = { sourceId, targetId, after };
    renderColumnSettings(move);
    applyLeaderboardColumnLayout({ move });
  }

  function createColumnSetting(id, column, host) {
    const item = document.createElement("div");
    item.className = "column-setting";
    item.draggable = true;
    item.dataset.columnId = id;
    const handle = document.createElement("span");
    handle.className = "column-drag-handle";
    handle.textContent = "⋮⋮";
    handle.title = `Drag ${column.name}`;
    const check = document.createElement("input");
    check.type = "checkbox";
    check.disabled = REQUIRED_COLUMN_IDS.includes(id);
    check.setAttribute("aria-label", `Show ${column.name}`);
    const name = document.createElement("span");
    name.textContent = column.name;
    name.addEventListener("click", () => {
      if (!check.disabled) check.click();
    });
    const moveLeft = document.createElement("button");
    moveLeft.type = "button";
    moveLeft.className = "column-move column-move-left";
    moveLeft.textContent = "←";
    moveLeft.setAttribute("aria-label", `Move ${column.name} left`);
    moveLeft.addEventListener("click", () => {
      const position = state.columnLayout.order.indexOf(id);
      if (position > 0) moveLeaderboardColumn(id, state.columnLayout.order[position - 1]);
    });
    const moveRight = document.createElement("button");
    moveRight.type = "button";
    moveRight.className = "column-move column-move-right";
    moveRight.textContent = "→";
    moveRight.setAttribute("aria-label", `Move ${column.name} right`);
    moveRight.addEventListener("click", () => {
      const position = state.columnLayout.order.indexOf(id);
      if (position < state.columnLayout.order.length - 1) {
        moveLeaderboardColumn(id, state.columnLayout.order[position + 1], true);
      }
    });
    item.append(handle, check, name, moveLeft, moveRight);
    check.addEventListener("change", () => {
      const nextHidden = new Set(state.columnLayout.hidden);
      if (check.checked) nextHidden.delete(id);
      else nextHidden.add(id);
      state.columnLayout = { ...state.columnLayout, hidden: [...nextHidden] };
      saveColumnLayout();
      renderColumnSettings();
      applyLeaderboardColumnLayout({
        revealId: check.checked ? id : null,
        visibilityId: id,
      });
    });
    item.addEventListener("dragstart", (event) => {
      clearColumnDropIndicators();
      item.classList.add("dragging");
      item.setAttribute("aria-grabbed", "true");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      item.removeAttribute("aria-grabbed");
      clearColumnDropIndicators();
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const source = host.querySelector(".column-setting.dragging")?.dataset.columnId;
      if (source === id) {
        clearColumnDropIndicators();
        return;
      }
      const after = event.clientY > item.getBoundingClientRect().top + item.offsetHeight / 2;
      showColumnDropIndicator(item, after);
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const after = item.classList.contains("column-drop-after");
      const sourceId = event.dataTransfer.getData("text/plain");
      clearColumnDropIndicators();
      moveLeaderboardColumn(sourceId, id, after);
    });
    return item;
  }

  function renderColumnSettings(move = null) {
    const host = document.querySelector("#column-settings-list");
    if (!host) return;
    const focused = host.contains(document.activeElement) ? document.activeElement : null;
    const hidden = new Set(state.columnLayout.hidden);
    const existing = new Map(
      [...host.querySelectorAll(".column-setting")].map((item) => [item.dataset.columnId, item]),
    );
    const ordered = [];
    for (const [position, id] of state.columnLayout.order.entries()) {
      const column = COLUMN_BY_ID.get(id);
      if (!column) continue;
      const item = existing.get(id) ?? createColumnSetting(id, column, host);
      item.querySelector('input[type="checkbox"]').checked = !hidden.has(id);
      item.querySelector(".column-move-left").disabled = position === 0;
      item.querySelector(".column-move-right").disabled =
        position === state.columnLayout.order.length - 1;
      ordered.push(item);
      existing.delete(id);
    }
    for (const item of existing.values()) item.remove();
    const source = move && ordered.find((item) => item.dataset.columnId === move.sourceId);
    const target = move && ordered.find((item) => item.dataset.columnId === move.targetId);
    if (source && target) {
      host.insertBefore(source, move.after ? target.nextElementSibling : target);
    } else {
      reconcileElementOrder(host, ordered);
    }
    if (focused?.isConnected) focused.focus({ preventScroll: true });
    if (!host.dataset.dragLeaveBound) {
      host.dataset.dragLeaveBound = "true";
      host.addEventListener("dragleave", (event) => {
        const bounds = host.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          clearColumnDropIndicators();
        }
      });
    }
  }

  function renderResultsTable(rows) {
    const host = document.querySelector("#results-grid");
    resultsGrid?.destroy();
    host.replaceChildren();
    state.rows = rows.toSorted((left, right) =>
      Number(right.fullBenchmark) - Number(left.fullBenchmark) || right.score - left.score);
    const tableColumns = leaderboardColumns();
    const data = state.rows.map((row, index) => [
      ...tableColumns.map((column) => column.cell(row, index)),
      index,
    ]);
    const columns = tableColumns.map((column) => ({
      name: column.name,
      id: column.id,
      sort: column.sort === false ? false : {},
      attributes: {
        "data-column-id": column.id,
        "data-value-kind": column.range || column.id === "#" ? "number" : "text",
      },
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
            "data-row-index": String(index),
            title: `Explain ${column.name.toLowerCase()}`,
            onClick: () =>
              column.open ? column.open(row) : openCellDetails(row, index, column.id),
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
    ensureLeaderboardTable();
  }

  /** Truncated cells keep their full value available on hover. */
  function addOverflowTitles(host) {
    for (const cell of host.querySelectorAll("tbody td")) {
      if (cell.scrollWidth > cell.clientWidth + 1) cell.title = cell.textContent?.trim() ?? "";
    }
  }

  return { COLUMN_BY_ID, DEFAULT_COLUMN_IDS, DEFAULT_COLUMN_LAYOUT, REQUIRED_COLUMN_IDS, saveColumnLayout, clearColumnDropIndicators, showColumnDropIndicator, moveLeaderboardColumn, applyLeaderboardColumnLayout, renderColumnSettings, renderResultsTable, addOverflowTitles };
}
