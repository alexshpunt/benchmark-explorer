import { aggregateGroupScore, aggregateToolUsage, taskFamily } from "../core.mjs";

/** Compact version marker, e.g. "codex-cli 0.153.4" becomes "0.153.4". */
export function compactVersion(version) {
  return version?.match(/[\d][\w.-]*$/u)?.[0] ?? version ?? "unknown";
}

/** Create comparison tables for selected matrix cells. */
export function createComparison(state, {
  mean, COLORS, rowsForCell, cellKeyFromRow, familyScore, activeFilters,
  openConfigurationDetails, openTaskFamilyDetails, openToolDetails,
}) {
  /**
   * Pooled family score of a set of configurations, from the shared aggregation.
   * The trials of every configuration are pooled per task, so a whole model and
   * one of its harnesses are measured the same way.
   */
  function pooledFamilyScore(rows, family) {
    return aggregateGroupScore(rows.filter((row) => row.fullBenchmark)
      .map((row) => familyScore(row, family)).filter(Boolean));
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
      if (cell.runId) {
        const source = document.createElement("span");
        source.className = "selection-source";
        source.textContent = `Run ${cell.runId}`;
        source.title = `Run ${cell.runId}`;
        button.append(source);
      }
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

  /**
   * Tool usage of one matrix cell. A cell that covers several harnesses sums the
   * calls and trials of all of them, so calls per trial stays a rate over trials.
   */
  function usageForCell(cell, usageRows) {
    const keys = new Set(rowsForCell(cell).map(cellKeyFromRow));
    const mine = usageRows.filter(
      (row) => keys.has(row.key) && (!cell.runId || row.runId === cell.runId),
    );
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
      const cell = state.matrixCellCache.get(key) ?? cells.find((candidate) => candidate.key === key);
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

  return { renderComparison, pooledFamilyScore };
}
