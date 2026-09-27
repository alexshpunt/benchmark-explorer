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
  let current = null;
  let width = 0;

  function hideTip() { tooltip.hidden = true; }
  function showTip(point, x, y) {
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
      (point.routes ? ` · ${point.routes} routes` : "") +
      (point.low < point.high ? ` · score range ${score(point.low)}–${score(point.high)}` : "");
    const hint = document.createElement("small");
    hint.textContent = state.selected.has(point.key) ? "Click to remove from comparison" : "Click to compare (up to 4)";
    tooltip.append(title, kind, values, sample, hint);
    tooltip.style.left = `${Math.max(8, Math.min(x + 18, host.clientWidth - 280))}px`;
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
    for (const point of [...points.filter((p) => !frontierKeys.has(p.key)), ...frontier]) {
      const xx = x(point.cost);
      const yy = y(point.score);
      if (point.low < point.high) {
        const whisker = svg("g", { class: "pareto-whisker" });
        whisker.append(svg("line", { x1: xx, x2: xx, y1: y(point.low), y2: y(point.high) }));
        for (const value of [point.low, point.high]) whisker.append(svg("line", {
          x1: xx - 4, x2: xx + 4, y1: y(value), y2: y(value),
        }));
        chart.append(whisker);
      }
      const size = frontierKeys.has(point.key) ? 14 : point.kind === "route" ? 12 : 16;
      const mark = svg("rect", { x: xx - size / 2, y: yy - size / 2, width: size, height: size,
        rx: 2, tabindex: 0, role: "button", class: `pareto-point pareto-${point.kind}` +
          (frontierKeys.has(point.key) ? " pareto-frontier-point" : "") +
          (state.selected.has(point.key) ? " is-selected" : ""),
        "aria-label": `${pointName(point)}. Score ${score(point.score)}, full run ${money(point.cost)}. Compare.`,
        "aria-pressed": String(state.selected.has(point.key)) });
      mark.addEventListener("pointerenter", () => showTip(point, xx, yy));
      mark.addEventListener("pointerleave", hideTip);
      mark.addEventListener("focus", () => showTip(point, xx, yy));
      mark.addEventListener("blur", hideTip);
      mark.addEventListener("click", () => { hideTip(); selectCell(point.key); });
      mark.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); mark.click(); }
      });
      chart.append(mark);
    }
    host.append(chart);
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
