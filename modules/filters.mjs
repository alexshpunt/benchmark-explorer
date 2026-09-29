import { canonicalModelFamily, popoverPosition, taskFamily } from "../core.mjs";

/** Create filter menus, ranges and leaderboard header controls. */
export function createFilters(state, {
  FILTER_LABELS, selectedValues, render, syncUrl, renderMatrixState, matrixCells,
  COLUMN_BY_ID, clearColumnDropIndicators, showColumnDropIndicator,
  moveLeaderboardColumn, applyLeaderboardColumnLayout, addOverflowTitles, formatNumber,
}) {
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
    const grouping = document.createElement("div");
    grouping.className = "matrix-group-options";
    for (const [value, label] of [["model", "Group models by family"], ["harness", "Group rare harnesses"], ["extension", "Group pi-extensions"]]) {
      const option = document.createElement("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = state.matrixGroups.has(value);
      check.addEventListener("change", () => {
        if (check.checked) state.matrixGroups.add(value);
        else state.matrixGroups.delete(value);
        renderMatrixState(matrixCells(state.configurations, state.compactConfigurations, state.expandedHarnesses));
        syncUrl(true);
      });
      option.append(check, document.createTextNode(label));
      grouping.append(option);
    }
    panel.prepend(grouping);
    repositionFilterPopover();
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
  let leaderboardTableObserver = null;
  let leaderboardTableFrame = null;
  function ensureLeaderboardTable() {
    if (leaderboardTableFrame != null) return;
    leaderboardTableFrame = requestAnimationFrame(() => {
      leaderboardTableFrame = null;
      const host = document.querySelector("#results-grid");
      if (!host) return;
      if (host.querySelector(".gridjs-th:not([data-header-controls])")) addHeaderControls(host);
      applyLeaderboardColumnLayout();
      addOverflowTitles(host);
    });
  }

  function addHeaderDrag(th, column) {
    if (th.dataset.columnDrag) return;
    th.dataset.columnDrag = "true";
    th.draggable = true;
    th.addEventListener("dragstart", (event) => {
      clearColumnDropIndicators();
      th.classList.add("column-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", column.id);
    });
    th.addEventListener("dragend", () => {
      th.classList.remove("column-dragging");
      clearColumnDropIndicators();
    });
    th.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const source = document.querySelector(".gridjs-th.column-dragging")?.dataset.columnId;
      if (source === column.id) {
        clearColumnDropIndicators();
        return;
      }
      const after = event.clientX > th.getBoundingClientRect().left + th.offsetWidth / 2;
      showColumnDropIndicator(th, after);
    });
    th.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const after = th.classList.contains("column-drop-after");
      const sourceId = event.dataTransfer.getData("text/plain");
      clearColumnDropIndicators();
      moveLeaderboardColumn(sourceId, column.id, after);
    });
  }

  function addHeaderControls(host) {
    for (const th of host.querySelectorAll(".gridjs-th")) {
      const column = COLUMN_BY_ID.get(th.dataset.columnId);
      if (!column) continue;
      th.dataset.headerControls = "true";
      th.title = column.tooltip;
      addHeaderDrag(th, column);
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

  leaderboardTableObserver = new MutationObserver(ensureLeaderboardTable);
  leaderboardTableObserver.observe(document.querySelector("#results-grid"), {
    childList: true,
    subtree: true,
  });

  return { renderActiveFilters, buildFilterMenus, repositionFilterPopover, placeFilterPopover, ensureLeaderboardTable, getLeaderboardTableObserver: () => leaderboardTableObserver, matchesRanges, renderRangeFilters };
}
