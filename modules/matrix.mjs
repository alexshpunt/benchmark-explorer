import {
  aggregateGroupScore, compareHarnessVersions, matrixHarnessGroup, median,
  modelRouteIdentity, observedMetricAverage, providerMedian,
  qualityPerDollar, relativeQualityPosition,
} from "../core.mjs";

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
const REVERSED_SCORE_RAMP_GRADIENT = `linear-gradient(90deg, ${[...SCORE_RAMP]
  .map((_stop, index) => scoreColor(1 - index / (SCORE_RAMP.length - 1)))
  .join(", ")})`;

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

/** Create the matrix with shared state and actions supplied by the entry point. */
export function createMatrix(state, {
  mean, OVERALL, COLORS, selectedValues, syncUrl, render, renderMatrixState,
  openModelDetails, openHarnessDetails,
}) {
  function cellKey(model, harness, version) {
    return JSON.stringify([model, harness, version ?? null]);
  }

  function matrixMetricSummary(rows, score) {
    const averageCost = observedMetricAverage(rows, "cost");
    return {
      averageCost,
      averageTokens: observedMetricAverage(rows, "tokens"),
      costObservations: rows.reduce((sum, row) => sum + row.cost.observations, 0),
      tokenObservations: rows.reduce((sum, row) => sum + row.tokens.observations, 0),
      qualityPerDollar: qualityPerDollar(score == null ? null : score * 100, averageCost),
    };
  }

  function matrixCell(model, harness, version, rows, options = {}) {
    const score = mean(rows.map((row) => row.score).filter((value) => value != null));
    return {
      key: options.key ?? cellKey(model, harness, version),
      columnKey: options.columnKey ?? `${harness}@${version ?? "unknown"}`,
      model,
      harness,
      version,
      runId: options.runId ?? null,
      sourceRows: options.sourceRows ?? null,
      compact: options.compact === true,
      label: `${harness}@${version ?? "unknown"}`,
      score,
      firstExactRate: aggregateGroupScore(rows.map((row) => ({ ...row, fullBenchmark: true }))).firstExactRate,
      finalExactRate: mean(rows.map((row) => row.finalExactRate).filter((value) => value != null)),
      recoveryGain: mean(rows.map((row) => row.recoveryGain).filter((value) => value != null)),
      duration: mean(
        rows.map((row) => row.durationSummary.averageCase).filter((value) => value != null),
      ),
      observations: rows.reduce((sum, row) => sum + row.observations, 0),
      ...matrixMetricSummary(rows, score),
    };
  }

  function matrixCells(configurationRows, compactRows, expandedHarnesses) {
    const byModel = new Map();
    for (const row of configurationRows) {
      const model = modelRouteIdentity(row);
      byModel.set(model, [...(byModel.get(model) ?? []), row]);
    }
    // The overall cell of a model pools its trials task by task, exactly like the
    // group score a model card reports.
    const overall = [...byModel].map(([model, rows]) => {
      const full = rows.filter((row) => row.fullBenchmark);
      const group = aggregateGroupScore(full);
      return {
        key: cellKey(model, OVERALL, null),
        columnKey: OVERALL,
        model,
        harness: OVERALL,
        version: null,
        overall: true,
        label: "Overall",
        score: group.score,
        firstExactRate: group.firstExactRate,
        finalExactRate: group.finalExactRate,
        recoveryGain: null,
        duration: mean(full.map((row) => row.durationSummary.averageCase)),
        observations: full.reduce((sum, row) => sum + row.observations, 0),
        ...matrixMetricSummary(full, group.score),
      };
    });
    const visible = [];
    const exactGroups = new Map();
    for (const row of configurationRows) {
      if (!expandedHarnesses.has(row.harnessFamily)) continue;
      const model = modelRouteIdentity(row);
      const key = cellKey(model, row.harnessFamily, row.harnessVersion);
      exactGroups.set(key, [...(exactGroups.get(key) ?? []), row]);
    }
    for (const [key, rows] of exactGroups) {
      const [model, harness, version] = JSON.parse(key);
      visible.push(matrixCell(model, harness, version, rows));
    }
    const compactGroups = new Map();
    for (const row of compactRows) {
      const model = modelRouteIdentity(row);
      const key = JSON.stringify([model, row.harnessFamily]);
      compactGroups.set(key, [...(compactGroups.get(key) ?? []), row]);
    }
    for (const [key, rows] of compactGroups) {
      const [model, harness] = JSON.parse(key);
      const version = rows[0]?.harnessVersion ?? null;
      const runId = rows[0]?.runId ?? null;
      const versions = configurationRows.filter((row) =>
        modelRouteIdentity(row) === model && row.harnessFamily === harness);
      const summary = matrixCell(model, harness, version, rows, {
        columnKey: harness,
        compact: true,
        key: JSON.stringify([model, harness, version, runId]),
        runId: null,
        sourceRows: rows,
      });
      if (versions.length) {
        const full = versions.filter((row) => row.fullBenchmark);
        summary.score = median(full.map((row) => row.score));
        summary.firstExactRate = aggregateGroupScore(full).firstExactRate;
        summary.finalExactRate = mean(full.map((row) => row.finalExactRate));
        summary.recoveryGain = mean(full.map((row) => row.recoveryGain));
        summary.duration = mean(full.map((row) => row.durationSummary.averageCase));
        summary.sourceRows = versions;
        summary.observations = full.reduce((total, row) => total + row.observations, 0);
        Object.assign(summary, matrixMetricSummary(full, summary.score));
      }
      visible.push(summary);
    }
    return [...overall, ...visible];
  }

  const MATRIX_METRICS = {
    score: {
      label: "Score",
      higherIsBetter: true,
      value: (cell) => (cell.score == null ? null : cell.score * 100),
      format: (value) => value.toFixed(1),
      detail: (cell) => `Score from ${cell.observations.toLocaleString()} observations`,
    },
    firstExact: {
      label: "First exact",
      higherIsBetter: true,
      value: (cell) => (cell.firstExactRate == null ? null : cell.firstExactRate * 100),
      format: (value) => `${value.toFixed(1)}%`,
      detail: (cell) =>
        `First-attempt exact rate from ${cell.observations.toLocaleString()} observations`,
    },
    avgCost: {
      label: "Average cost",
      higherIsBetter: false,
      value: (cell) => cell.averageCost,
      format: (value) => `$${value.toFixed(4)}`,
      detail: (cell) =>
        `Average reported cost across ${cell.costObservations.toLocaleString()} trials`,
    },
    avgTokens: {
      label: "Average tokens",
      higherIsBetter: false,
      value: (cell) => cell.averageTokens,
      format: (value) => Math.round(value).toLocaleString(),
      detail: (cell) =>
        `Average reported tokens across ${cell.tokenObservations.toLocaleString()} trials`,
    },
    qualityPerDollar: {
      label: "Quality per dollar",
      higherIsBetter: true,
      value: (cell) => cell.qualityPerDollar,
      format: (value) => value.toLocaleString(undefined, { maximumFractionDigits: 1 }),
      detail: (cell) =>
        `Score points ÷ $${cell.averageCost.toFixed(4)} average cost across ${cell.costObservations.toLocaleString()} reported trials`,
    },
  };

  /** Filter-visible rows behind one matrix cell. */
  function rowsForCell(cell) {
    if (cell.sourceRows) return cell.sourceRows;
    return state.configurations.filter(
      (row) =>
        modelRouteIdentity(row) === cell.model &&
        (cell.overall || (row.harnessFamily === cell.harness && row.harnessVersion === cell.version)),
    );
  }

  /** Tool-usage key for one configuration row, matching the aggregation key. */
  function cellKeyFromRow(row) {
    return cellKey(modelRouteIdentity(row), row.harnessFamily, row.harnessVersion);
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

  function matrixGroupFilterButton(group) {
    const harnesses = new Set(state.configurations
      .map((row) => row.harnessFamily)
      .filter((harness) => matrixHarnessGroup(harness) === group));
    const selected = selectedValues("harness");
    const active = selected.size === harnesses.size && [...harnesses].every((value) => selected.has(value));
    const button = matrixFilterButton("harness", group, group).cloneNode(true);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", `${active ? "Clear" : "Filter to"} ${group} harnesses`);
    button.title = button.getAttribute("aria-label");
    button.addEventListener("click", () => {
      selected.clear();
      if (!active) for (const harness of harnesses) selected.add(harness);
      state.selected.clear();
      render();
      syncUrl();
    });
    return button;
  }
  function toggleHarnessExpansion(harness) {
    if (state.expandedHarnesses.has(harness)) state.expandedHarnesses.delete(harness);
    else state.expandedHarnesses.add(harness);
    renderMatrixState(
      matrixCells(state.configurations, state.compactConfigurations, state.expandedHarnesses),
    );
    const nextToggle = [...document.querySelectorAll(".matrix-expand-toggle")].find(
      (button) => button.dataset.harness === harness,
    );
    nextToggle?.focus();
    syncUrl(true);
  }

  function matrixExpansionButton(harness) {
    const expanded = state.expandedHarnesses.has(harness);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "matrix-expand-toggle";
    button.dataset.harness = harness;
    button.textContent = expanded ? "‹" : "›";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${harness} versions`);
    button.title = `${expanded ? "Collapse" : "Expand"} ${harness} versions`;
    button.addEventListener("click", () => toggleHarnessExpansion(harness));
    return button;
  }
  /** Build collapsed columns and model rows from the route-level matrix cells. */
  function groupedMatrixCells(cells) {
    const models = state.matrixGroups.has("model");
    const harnesses = state.matrixGroups.has("harness");
    const extensions = state.matrixGroups.has("extension");
    const groups = new Map();
    const add = (cell) => groups.set(JSON.stringify([cell.model, cell.columnKey]), cell);
    for (const cell of cells) add(cell);
    const columnGroups = new Map();
    for (const cell of cells) {
      if (cell.overall || !cell.compact) continue;
      const label = matrixHarnessGroup(cell.harness);
      if ((label === "DeepSeek" && harnesses) || (label === "pi-extensions" && extensions)) {
        const key = JSON.stringify([cell.model, label]);
        columnGroups.set(key, [...(columnGroups.get(key) ?? []), cell]);
      }
    }
    const collapse = (members, model, columnKey, harness) => {
      const first = members[0];
      const fields = ["score", "firstExactRate", "finalExactRate", "recoveryGain", "duration", "averageCost", "averageTokens", "qualityPerDollar"];
      const values = Object.fromEntries(fields.map((field) => [field, providerMedian(members, field)]));
      return { ...first, ...values, key: "group:" + JSON.stringify([model, columnKey]), model,
        columnKey, harness, label: harness === OVERALL ? "Overall" : harness,
        compact: first.compact, grouped: true, sourceRows: [...new Set(members.flatMap(rowsForCell))],
        observations: members.reduce((sum, cell) => sum + cell.observations, 0),
        costObservations: members.reduce((sum, cell) => sum + cell.costObservations, 0),
        tokenObservations: members.reduce((sum, cell) => sum + cell.tokenObservations, 0) };
    };
    for (const [key, members] of columnGroups) {
      const [model, label] = JSON.parse(key);
      add(collapse(members, model, label, label));
    }
    if (models) {
      const familyGroups = new Map();
      for (const cell of groups.values()) {
        const family = cell.model.split("\t")[0];
        const key = JSON.stringify([family, cell.columnKey]);
        familyGroups.set(key, [...(familyGroups.get(key) ?? []), cell]);
      }
      for (const [key, members] of familyGroups) {
        const [family, columnKey] = JSON.parse(key);
        add(collapse(members, family, columnKey, members[0].harness));
      }
    }
    return [...groups.values()].filter((cell) => {
      if (models && cell.model.includes("\t") && !state.expandedModels.has(cell.model.split("\t")[0])) return false;
      const group = matrixHarnessGroup(cell.harness);
      if (cell.columnKey !== group && ((group === "DeepSeek" && harnesses) ||
        (group === "pi-extensions" && extensions)) && !state.expandedMatrixGroups.has(group)) return false;
      return true;
    });
  }

  function renderMatrix(cells) {
    const root = document.querySelector("#matrix-view");
    root.replaceChildren();
    const metric = MATRIX_METRICS[state.matrixMetric];
    document.querySelector("#matrix-metric").value = state.matrixMetric;
    const overallScore = new Map(
      cells.filter((cell) => cell.overall).map((cell) => [cell.model, cell.score ?? 0]),
    );
    const models = [...new Set(cells.map((cell) => cell.model))].sort((left, right) => {
      const leftFamily = left.split("\t")[0];
      const rightFamily = right.split("\t")[0];
      if (state.matrixGroups.has("model") && leftFamily === rightFamily)
        return Number(left.includes("\t")) - Number(right.includes("\t")) || left.localeCompare(right);
      return (overallScore.get(rightFamily) ?? overallScore.get(right) ?? 0) -
        (overallScore.get(leftFamily) ?? overallScore.get(left) ?? 0) || left.localeCompare(right);
    });
    const overall = cells.find((cell) => cell.overall);
    const harnessScores = new Map();
    for (const row of state.configurations) {
      harnessScores.set(row.harnessFamily, [
        ...(harnessScores.get(row.harnessFamily) ?? []),
        row,
      ]);
    }
    // Ranking keeps measured quality dominant while preferring harness families
    // that have evidence for more of the currently visible models.
    const rankByHarness = new Map(
      [...harnessScores].map(([harness, rows]) => {
        const score = aggregateGroupScore(rows).score;
        const testedModels = new Set(rows.map(modelRouteIdentity)).size;
        const completeness = models.length ? testedModels / models.length : 0;
        return [harness, score * (0.75 + 0.25 * completeness)];
      }),
    );
    const byHarness = new Map();
    for (const cell of cells.filter((candidate) => !candidate.overall)) {
      byHarness.set(cell.harness, [...(byHarness.get(cell.harness) ?? []), cell]);
    }
    const harnessOrder = [...byHarness.keys()].sort((left, right) => {
      const a = matrixHarnessGroup(left);
      const b = matrixHarnessGroup(right);
      if (a === b) return left === a ? -1 : right === b ? 1 : left.localeCompare(right);
      return (rankByHarness.get(b) ?? 0) - (rankByHarness.get(a) ?? 0) || a.localeCompare(b);
    });
    const harnesses = harnessOrder.flatMap((harness) => {
      const unique = [
        ...new Map(byHarness.get(harness).map((cell) => [cell.columnKey, cell])).values(),
      ];
      return state.expandedHarnesses.has(harness)
        ? unique.sort((left, right) =>
            Number(right.compact) - Number(left.compact) ||
            compareHarnessVersions(right.version ?? "", left.version ?? ""))
        : unique.filter((cell) => cell.compact).slice(0, 1);
    });
    const series = overall ? [overall, ...harnesses] : harnesses;
    const byPosition = new Map(cells.map((cell) => [`${cell.model}\0${cell.columnKey}`, cell]));
    // Selected cells take the colour of their series, in selection order, so a
    // cell and the chip that stands for it read as one thing.
    const selectionOrder = new Map([...state.selected].map((key, index) => [key, index]));
    // The ramp spans observed values for the selected metric. Missing values stay missing.
    const metricValues = cells.map(metric.value).filter(Number.isFinite);
    const { low, high } = metricValues.length ? rampBounds(metricValues) : { low: 0, high: 0 };
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
      const expanded = state.expandedHarnesses.has(seriesCell.harness);
      const group = matrixHarnessGroup(seriesCell.harness);
      const inExpandedGroup = (group === "DeepSeek" || group === "pi-extensions") &&
        state.expandedMatrixGroups.has(group) && state.matrixGroups.has(
          group === "DeepSeek" ? "harness" : "extension");
      th.classList.toggle("matrix-expanded-head", expanded || inExpandedGroup ||
        (seriesCell.grouped && state.expandedMatrixGroups.has(seriesCell.harness)));
      th.title = ["DeepSeek", "pi-extensions"].includes(seriesCell.harness)
        ? `${seriesCell.harness}\nMedian across the group's harnesses per provider route`
        : seriesCell.compact
          ? `${seriesCell.harness}\nMedian score across available versions for each model route`
          : seriesCell.label;
      const columnButton = document.createElement("button");
      columnButton.type = "button";
      columnButton.className = "matrix-header";
      const columnLabel = document.createElement("span");
      columnLabel.className = "matrix-header-label";
      columnLabel.textContent = seriesCell.harness === "dsh-code" ? "DeepSeek codemode" :
        seriesCell.harness === "dsh-standard" ? "DeepSeek standard" :
        seriesCell.compact ? seriesCell.harness : `${seriesCell.harness} ${seriesCell.version ?? "unknown"}`;
      columnButton.append(columnLabel);
      const detailsVersion = seriesCell.compact ? null : seriesCell.version;
      columnButton.title = `Open ${seriesCell.compact ? seriesCell.harness : seriesCell.label}`;
      if (!seriesCell.grouped || !["DeepSeek", "pi-extensions"].includes(seriesCell.harness))
        columnButton.addEventListener("click", () => openHarnessDetails(seriesCell.harness, detailsVersion));
      th.append(columnButton);
      const actions = document.createElement("span");
      actions.className = "matrix-header-actions";
      if (seriesCell.grouped && ["DeepSeek", "pi-extensions"].includes(seriesCell.harness)) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "matrix-expand-toggle";
        const expandedGroup = state.expandedMatrixGroups.has(seriesCell.harness);
        toggle.textContent = expandedGroup ? "‹" : "›";
        toggle.setAttribute("aria-expanded", String(expandedGroup));
        toggle.setAttribute("aria-label", (expandedGroup ? "Collapse " : "Expand ") + seriesCell.harness + " harnesses");
        toggle.addEventListener("click", () => {
          if (expandedGroup) state.expandedMatrixGroups.delete(seriesCell.harness);
          else state.expandedMatrixGroups.add(seriesCell.harness);
          renderMatrixState(matrixCells(state.configurations, state.compactConfigurations, state.expandedHarnesses));
          syncUrl(true);
        });
        actions.append(toggle, matrixGroupFilterButton(seriesCell.harness));
      } else if (seriesCell.compact) actions.append(matrixExpansionButton(seriesCell.harness));
      const filterName = seriesCell.compact ? "harness" : "harnessVersion";
      const filterValue = seriesCell.compact
        ? seriesCell.harness
        : seriesCell.harness + "\t" + seriesCell.version;
      if (!seriesCell.grouped || !["DeepSeek", "pi-extensions"].includes(seriesCell.harness)) actions.append(
        matrixFilterButton(
          filterName,
          filterValue,
          seriesCell.compact ? seriesCell.harness : seriesCell.label,
        ),
      );
      th.append(actions);
      headRow.append(th);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const model of models) {
      const row = document.createElement("tr");
      const heading = document.createElement("th");
      heading.className = "matrix-model-column";
      heading.scope = "row";
      const [modelFamily, provider] = model.split("\t");
      const modelLabel = provider ? `${modelFamily} · ${provider}` : modelFamily;
      heading.classList.toggle("matrix-expanded-model",
        state.matrixGroups.has("model") && state.expandedModels.has(modelFamily));
      heading.title = `Open ${modelLabel}`;
      const rowButton = document.createElement("button");
      rowButton.type = "button";
      rowButton.className = "matrix-header";
      const rowLabel = document.createElement("span");
      rowLabel.className = "matrix-header-label";
      rowLabel.textContent = modelLabel;
      rowButton.append(rowLabel);
      rowButton.addEventListener("click", () => provider && openModelDetails(model));
      heading.append(rowButton);
      const rowActions = document.createElement("span");
      rowActions.className = "matrix-header-actions";
      if (state.matrixGroups.has("model") && !provider) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "matrix-expand-toggle matrix-model-toggle";
        const expanded = state.expandedModels.has(modelFamily);
        const chevron = document.createElement("span");
        chevron.textContent = "›";
        toggle.append(chevron);
        toggle.setAttribute("aria-expanded", String(expanded));
        toggle.setAttribute("aria-label", (expanded ? "Collapse " : "Expand ") + modelFamily + " providers");
        toggle.addEventListener("click", () => {
          if (expanded) state.expandedModels.delete(modelFamily);
          else state.expandedModels.add(modelFamily);
          renderMatrixState(matrixCells(state.configurations, state.compactConfigurations, state.expandedHarnesses));
          syncUrl(true);
        });
        rowActions.append(toggle);
      }
      rowActions.append(matrixFilterButton("model", modelFamily, modelFamily));
      if (provider) rowActions.append(matrixFilterButton("provider", provider, provider));
      heading.append(rowActions);
      row.append(heading);
      for (const seriesCell of series) {
        const td = document.createElement("td");
        const cell = byPosition.get(`${model}\0${seriesCell.columnKey}`);
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
          const value = metric.value(cell);
          const source = cell.runId
            ? `${cell.label}\nRun: ${cell.runId}`
            : cell.label;
          const note = !cell.overall && !cell.compact && rowsForCell(cell).every((row) => !row.fullBenchmark)
            ? "\nPartial benchmark run; excluded from summary scores" : "";
          if (value == null) {
            button.textContent = "—";
            button.classList.add("matrix-value-missing");
            button.title = `${modelLabel}\n${source}${note}\n${metric.label}: not reported\n${chosen ? "Selected — click to remove" : "Click to compare"}`;
          } else {
            button.style.setProperty(
              "--score-color",
              scoreColor(relativeQualityPosition(value, low, high, metric.higherIsBetter)),
            );
            button.textContent = metric.format(value);
            button.title = `${modelLabel}\n${source}${note}\n${metric.label}: ${metric.format(value)}\n${metric.detail(cell)}\n${chosen ? "Selected — click to remove" : "Click to compare"}`;
          }
          button.setAttribute("aria-label", button.title.replaceAll("\n", ". "));
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
    const observed = metricValues.length > 0;
    min.textContent = observed ? metric.format(low) : "—";
    max.textContent = observed ? metric.format(high) : "—";
    const lowMeaning = metric.higherIsBetter ? "worst" : "best";
    const highMeaning = metric.higherIsBetter ? "best" : "worst";
    min.title = `${metric.label}: ${lowMeaning} visible value`;
    max.title = `${metric.label}: ${highMeaning} visible value`;
    document.querySelector("#matrix-scale-label").textContent = metric.label;
    const ramp = document.querySelector(".matrix-legend-ramp");
    ramp.style.background = metric.higherIsBetter
      ? SCORE_RAMP_GRADIENT
      : REVERSED_SCORE_RAMP_GRADIENT;
    ramp.title = `${metric.label}: lower visible values are ${lowMeaning}, higher values are ${highMeaning}`;
  }

  return { matrixCells, groupedMatrixCells, renderMatrix, rowsForCell, cellKeyFromRow };
}
