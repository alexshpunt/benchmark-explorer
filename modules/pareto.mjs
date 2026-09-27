import { paretoFrontier, paretoPoints } from "./pareto-data.mjs";

const NS = "http://www.w3.org/2000/svg";
const money = (value) => `$${value.toFixed(value < 0.1 ? 3 : value < 1 ? 2 : 1)}`;
const score = (value) => (value * 100).toFixed(1);
const svg = (name, attrs = {}) => {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
};
const pointName = (point) => point.kind === "route"
  ? `${point.model} · ${point.provider} / ${point.harness}`
  : point.kind === "model" ? `${point.model} / all harnesses` : `All models / ${point.harness}`;

/** Draw a keyboard-accessible price × score frontier from the same cells as the matrix. */
export function createPareto(state, selectCell) {
  const host = document.querySelector("#pareto-chart");
  const list = document.querySelector("#pareto-list");
  const context = document.querySelector("#pareto-context");
  const tooltip = document.querySelector("#pareto-tip");
  const nearbySection = document.querySelector("#pareto-nearby");
  const nearbyList = document.querySelector("#pareto-nearby-list");
  let nearbyKey = null;
  let current = null;
  let width = 0;

  function hideTip() { tooltip.hidden = true; }
  function showTip(point, x, y, nearbyCount = 0) {
    tooltip.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = pointName(point);
    const kind = document.createElement("small");
    kind.textContent = point.kind === "route" ? "Model route × harness" :
      point.kind === "model" ? "Model across harnesses" : "Harness across models";
    const values = document.createElement("span");
    values.textContent = `Score ${score(point.score)} · Full run ${money(point.cost)}`;
    const sample = document.createElement("span");
    sample.textContent = `${point.runs} ${point.runs === 1 ? "run" : "runs"} · ${point.observations.toLocaleString()} trials` +
      (point.routes ? ` · ${point.routes} routes (${point.pricedRoutes} priced)` : "");
    tooltip.append(title, kind, values, sample);
    const range = point.kind === "route" ? point.runRange : point.range;
    if (range) {
      const detail = document.createElement("span");
      detail.className = `pareto-tip-${point.kind}-range`;
      detail.textContent = point.kind === "route"
        ? `Repeated runs · ${point.version}: ${score(range.low)}–${score(range.high)}`
        : `${point.kind === "model" ? "Across harnesses" : "Across models"}: ${score(range.low)}–${score(range.high)}`;
      tooltip.append(detail);
    }
    const hint = document.createElement("small");
    hint.textContent = state.selected.has(point.key) ? "Click to remove from comparison" : "Click to compare (up to 4)";
    tooltip.append(hint);
    if (nearbyCount > 1) {
      const nearbyHint = document.createElement("small");
      nearbyHint.textContent = `${nearbyCount} nearby points — choose any from Nearby points`;
      tooltip.append(nearbyHint);
    }
    tooltip.style.left = `${Math.max(8, Math.min(x + 18, host.clientWidth - 320))}px`;
    tooltip.style.top = `${Math.max(8, y - 16)}px`;
    tooltip.hidden = false;
  }

  function render(cells) {
    current = paretoPoints(cells);
    const { points, unpriced } = current;
    for (const point of points) state.matrixCellCache.set(point.key, point.cell);
    const frontier = paretoFrontier(points);
    context.textContent = `${points.filter((p) => p.kind === "route").length} priced combinations · ` +
      `${frontier.length} on the frontier` + (unpriced ? ` · ${unpriced} without a complete price` : "");
    host.replaceChildren();
    list.replaceChildren();
    nearbySection.hidden = true;
    nearbyList.replaceChildren();
    hideTip();
    if (!points.length) {
      const empty = document.createElement("p");
      empty.className = "pareto-empty";
      empty.textContent = "No complete, fully priced runs match these filters. The matrix below still shows unpriced results.";
      host.append(empty);
      return;
    }
    const w = Math.max(240, host.clientWidth || 240);
    width = w;
    const h = w < 580 ? 390 : 470;
    const pad = { left: 52, right: 24, top: 32, bottom: 48 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const logPrices = points.map((p) => Math.log10(p.cost));
    const xmin = Math.min(...logPrices) - 0.12;
    const xmax = Math.max(...logPrices) + 0.12;
    const scores = points.flatMap((p) => [p.low, p.high]);
    const ymin = Math.max(0, Math.floor((Math.min(...scores) - 0.04) * 10) / 10);
    const ymax = Math.min(1, Math.ceil((Math.max(...scores) + 0.02) * 10) / 10);
    const x = (cost) => pad.left + (Math.log10(cost) - xmin) / (xmax - xmin) * plotW;
    const y = (value) => pad.top + (ymax - value) / Math.max(0.01, ymax - ymin) * plotH;
    const chart = svg("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h,
      role: "group", "aria-label": "Price versus score; square marks are selectable configurations" });
    for (let tick = Math.ceil(ymin * 10); tick <= Math.floor(ymax * 10); tick++) {
      const value = tick / 10;
      const yy = y(value);
      chart.append(svg("line", { x1: pad.left, x2: w - pad.right, y1: yy, y2: yy, class: "pareto-grid" }));
      const label = svg("text", { x: pad.left - 9, y: yy + 4, "text-anchor": "end", class: "pareto-tick" });
      label.textContent = `${tick * 10}`;
      chart.append(label);
    }
    for (let power = Math.floor(xmin); power <= Math.floor(xmax); power++) {
      for (const multiplier of [1, 2, 5]) {
        const value = multiplier * 10 ** power;
        if (Math.log10(value) < xmin || Math.log10(value) > xmax) continue;
        const xx = x(value);
        chart.append(svg("line", { x1: xx, x2: xx, y1: pad.top, y2: h - pad.bottom, class: "pareto-grid" }));
        const label = svg("text", { x: xx, y: h - pad.bottom + 19, "text-anchor": "middle", class: "pareto-tick" });
        label.textContent = money(value);
        chart.append(label);
      }
    }
    const axis = svg("text", { x: pad.left, y: 17, class: "pareto-axis" });
    axis.textContent = "Score ↑";
    const priceAxis = svg("text", { x: w - pad.right, y: h - 6, "text-anchor": "end", class: "pareto-axis" });
    priceAxis.textContent = "Full-run price → (log scale)";
    chart.append(axis, priceAxis);
    if (frontier.length > 1) chart.append(svg("polyline", {
      points: frontier.map((p) => `${x(p.cost)},${y(p.score)}`).join(" "),
      class: "pareto-line", fill: "none",
    }));
    const frontierKeys = new Set(frontier.map((p) => p.key));
    const orderedPoints = [...points.filter((p) => p.kind !== "route"),
      ...points.filter((p) => p.kind === "route" && !frontierKeys.has(p.key)), ...frontier];
    function showNearby(point) {
      nearbyKey = point.key;
      const neighbors = orderedPoints.filter((candidate) =>
        Math.abs(x(candidate.cost) - x(point.cost)) <= 18 &&
        Math.abs(y(candidate.score) - y(point.score)) <= 18);
      nearbyList.replaceChildren();
      nearbySection.hidden = neighbors.length < 2;
      for (const candidate of neighbors) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pareto-nearby-item";
        button.setAttribute("aria-pressed", String(state.selected.has(candidate.key)));
        button.textContent = pointName(candidate);
        const values = document.createElement("span");
        values.textContent = `${score(candidate.score)} · ${money(candidate.cost)}`;
        button.append(values);
        button.addEventListener("click", () => selectCell(candidate.key));
        nearbyList.append(button);
      }
      return neighbors.length;
    }
    const whiskersByPoint = new Map();
    function addWhisker(point, range, kind) {
      const xx = x(point.cost);
      const whisker = svg("g", { class: `pareto-whisker pareto-whisker-${kind}`,
        "data-point-key": point.key });
      whisker.append(svg("line", { x1: xx, x2: xx, y1: y(range.low), y2: y(range.high) }));
      for (const value of [range.low, range.high]) whisker.append(svg("line", {
        x1: xx - 4, x2: xx + 4, y1: y(value), y2: y(value),
      }));
      chart.append(whisker);
      whiskersByPoint.set(point.key, whisker);
    }
    for (const point of orderedPoints) {
      const range = point.kind === "route" ? point.runRange : point.range;
      if (range) addWhisker(point, range, point.kind === "route" ? "repeats" : point.kind);
    }
    for (const point of orderedPoints) {
      const xx = x(point.cost);
      const yy = y(point.score);
      const size = frontierKeys.has(point.key) ? 14 : point.kind === "route" ? 12 : 16;
      const mark = svg("rect", { x: xx - size / 2, y: yy - size / 2, width: size, height: size,
        rx: 2, tabindex: 0, role: "button", class: `pareto-point pareto-${point.kind}` +
          (frontierKeys.has(point.key) ? " pareto-frontier-point" : "") +
          (state.selected.has(point.key) ? " is-selected" : ""),
        "aria-label": `${pointName(point)}. Score ${score(point.score)}, full run ${money(point.cost)}.` +
          (point.kind === "route" && point.runRange
            ? ` Repeated full runs ${score(point.runRange.low)}–${score(point.runRange.high)}.` : "") +
          (point.kind !== "route" && point.range
            ? ` Range ${score(point.range.low)}–${score(point.range.high)}.` : "") + " Compare.",
        "aria-pressed": String(state.selected.has(point.key)) });
      const highlight = (active) => {
        whiskersByPoint.get(point.key)?.classList.toggle("is-active", active);
        if (active) showTip(point, xx, yy, showNearby(point));
        else hideTip();
      };
      mark.addEventListener("pointerenter", () => highlight(true));
      mark.addEventListener("pointerleave", () => highlight(false));
      mark.addEventListener("focus", () => highlight(true));
      mark.addEventListener("blur", () => highlight(false));
      const activate = () => { hideTip(); selectCell(point.key); };
      mark.addEventListener("click", activate);
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
      });
      chart.append(mark);
    }
    host.append(chart);
    if (nearbyKey) {
      const previous = points.find((point) => point.key === nearbyKey);
      if (previous) showNearby(previous);
      else nearbyKey = null;
    }
    for (const point of [...frontier].reverse()) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pareto-list-item";
      button.classList.toggle("is-selected", state.selected.has(point.key));
      button.setAttribute("aria-pressed", String(state.selected.has(point.key)));
      button.title = `Compare ${pointName(point)}`;
      const name = document.createElement("strong");
      name.textContent = `${point.model} · ${point.provider}`;
      const harness = document.createElement("small");
      harness.textContent = point.harness;
      const values = document.createElement("span");
      values.textContent = `${score(point.score)}  /  ${money(point.cost)}`;
      button.append(name, harness, values);
      button.addEventListener("click", () => selectCell(point.key));
      item.append(button);
      list.append(item);
    }
  }
  const observer = new ResizeObserver(() => {
    if (current && Math.abs(host.clientWidth - width) > 2) render(state.paretoCells ?? []);
  });
  observer.observe(host);
  return { render };
}
