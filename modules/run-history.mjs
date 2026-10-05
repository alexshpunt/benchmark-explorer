import { modelRouteIdentity, modelRouteLabel } from "../core.mjs";

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const seriesKey = (row) => JSON.stringify([modelRouteIdentity(row), row.harnessFamily,
  row.agentFamily, row.benchmarkId, row.benchmarkVersion, row.contract, row.transport, row.harnessKind]);
const datesFor = (snapshot) => new Map((snapshot?.acceptedRuns ?? []).map(run => [run.runId, run.acceptedAt]));
const timestamp = (date) => date ? Date.parse(date) : NaN;

/** Describe publication dates of source runs without inventing missing dates. */
export function publicationDateText(runIds, snapshot) {
  const dates = datesFor(snapshot);
  const times = [...new Set(runIds)].map(id => timestamp(dates.get(id)));
  const valid = times.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return "Unavailable";
  const first = dateFormat.format(valid[0]);
  const last = dateFormat.format(valid.at(-1));
  const missing = times.length - valid.length;
  return `${first === last ? first : `${first} – ${last}`}${missing ? ` · ${missing} unavailable` : ""}`;
}

/** Select historical evidence for these routes, not rating rows or derived scores. */
export function configurationHistory(rows, snapshot, { runId } = {}) {
  const keys = new Set(rows.map(seriesKey));
  const dates = datesFor(snapshot);
  const groups = new Map();
  for (const row of snapshot?.runRows?.all ?? []) {
    const key = seriesKey(row);
    if (!keys.has(key) || (runId && row.runId !== runId)) continue;
    const group = groups.get(key) ?? { row, rows: [], points: [], undated: 0 };
    group.rows.push(row);
    if (row.fullBenchmark && Number.isFinite(row.score)) {
      const time = timestamp(dates.get(row.runId));
      if (Number.isFinite(time)) group.points.push({ row, time, score: row.score * 100 });
      else group.undated += 1;
    }
    groups.set(key, group);
  }
  for (const group of groups.values()) group.points.sort((a, b) => a.time - b.time || a.row.runId.localeCompare(b.row.runId));
  return [...groups.values()];
}

function svgNode(tag, attributes, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text != null) node.textContent = text;
  return node;
}

/** Render one shared date axis with colored series, a legend, and accessible run lists. */
export function renderConfigurationHistory(rows, snapshot, openRun, options) {
  const host = document.createElement("div");
  host.className = "configuration-history";
  const groups = configurationHistory(rows, snapshot, options);
  if (!groups.length) return host;
  const figure = document.createElement("figure");
  figure.className = "run-history";
  const caption = document.createElement("figcaption");
  caption.textContent = "Published score history";
  figure.append(caption);
  const points = groups.flatMap(group => group.points);
  let svg;
  let x;
  const y = score => 142 - score / 100 * 120;
  if (points.length) {
    svg = svgNode("svg", { viewBox: "0 0 600 180", role: "group", "aria-label": "Published score history" });
    const first = Math.min(...points.map(point => point.time));
    const last = Math.max(...points.map(point => point.time));
    x = time => first === last ? 316 : 42 + (time - first) / (last - first) * 548;
    for (const score of [0, 50, 100]) {
      svg.append(svgNode("line", { x1: 42, x2: 590, y1: y(score), y2: y(score), class: "history-grid" }),
        svgNode("text", { x: 33, y: y(score) + 4, "text-anchor": "end" }, score));
    }
    svg.append(svgNode("text", { x: 42, y: 12 }, "Score"),
      svgNode("text", { x: first === last ? 316 : 42, y: 166, "text-anchor": first === last ? "middle" : "start" }, dateFormat.format(first)));
    if (last !== first) svg.append(svgNode("text", { x: 590, y: 166, "text-anchor": "end" }, dateFormat.format(last)));
    figure.append(svg);
  }
  const legend = document.createElement("div");
  legend.className = "history-legend";
  legend.setAttribute("aria-label", "History series; select a series to inspect its runs");
  figure.append(legend);
  const note = document.createElement("p");
  note.textContent = points.length
    ? `Publication date (UTC) · ${points.length} full ${points.length === 1 ? "result" : "results"} · select a point or a series below.`
    : "No dated full results to plot.";
  const undated = groups.reduce((total, group) => total + group.undated, 0);
  if (undated) note.textContent += ` ${undated} full ${undated === 1 ? "result has" : "results have"} no publication date.`;
  figure.append(note);
  const dates = datesFor(snapshot);
  groups.forEach((group, index) => {
    const baseLabel = row => `${modelRouteLabel(row)} · ${row.harnessFamily}`;
    const peers = groups.filter(peer => baseLabel(peer.row) === baseLabel(group.row));
    const differences = [["agentFamily", "agent"], ["benchmarkId", "benchmark"], ["benchmarkVersion", "benchmark version"],
      ["contract", "contract"], ["transport", "transport"], ["harnessKind", "harness kind"]]
      .filter(([field]) => peers.some(peer => peer.row[field] !== group.row[field]))
      .map(([field, name]) => `${name} ${group.row[field] ?? "unspecified"}`);
    const label = [baseLabel(group.row), ...differences].join(" · ");
    const color = index < 4 ? `var(--series-${index + 1})` : `oklch(65% 0.15 ${(index * 137.508) % 360})`;
    if (svg && group.points.length) {
      const series = svgNode("g", { class: "history-series", "data-series-label": label, role: "group", "aria-label": label });
      series.style.setProperty("--history-color", color);
      series.append(svgNode("polyline", { points: group.points.map(p => `${x(p.time)},${y(p.score)}`).join(" "), class: "history-line" }));
      for (const point of group.points) {
        const description = `${point.row.runId}: ${point.score.toFixed(1)}, published ${dateFormat.format(point.time)}, ${label} ${point.row.harnessVersion ?? "unspecified"}`;
        const circle = svgNode("circle", { cx: x(point.time), cy: y(point.score), r: 5, tabindex: 0, role: "button",
          "aria-label": description, "data-run-id": point.row.runId, class: "run-history-point" });
        circle.append(svgNode("title", {}, description));
        circle.addEventListener("click", () => openRun(point.row.runId));
        circle.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRun(point.row.runId); }
        });
        series.append(circle);
      }
      svg.append(series);
    }
    const disclosure = document.createElement("details");
    disclosure.className = "history-runs";
    disclosure.dataset.seriesLabel = label;
    const summary = document.createElement("summary");
    summary.textContent = `${label} · Run history (${group.rows.length})`;
    const list = document.createElement("ul");
    const order = row => { const time = timestamp(dates.get(row.runId)); return Number.isFinite(time) ? time : Infinity; };
    const sorted = group.rows.toSorted((a, b) => order(a) - order(b) || a.runId.localeCompare(b.runId));
    for (const row of sorted) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "details-link";
      const score = row.fullBenchmark && Number.isFinite(row.score) ? (row.score * 100).toFixed(1) : "— (partial or unavailable)";
      button.textContent = `${publicationDateText([row.runId], snapshot)} · ${score} · ${row.harnessFamily} ${row.harnessVersion ?? "unspecified"} · ${row.runId}`;
      button.addEventListener("click", () => openRun(row.runId));
      item.append(button);
      list.append(item);
    }
    disclosure.append(summary, list);
    figure.append(disclosure);
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "details-link";
    entry.title = `Show run history for ${label}`;
    entry.style.setProperty("--history-color", color);
    const swatch = document.createElement("span");
    swatch.className = "history-swatch";
    swatch.setAttribute("aria-hidden", "true");
    entry.append(swatch, label);
    entry.addEventListener("click", () => {
      disclosure.open = true;
      summary.focus();
      disclosure.scrollIntoView({ block: "nearest" });
    });
    legend.append(entry);
  });
  host.append(figure);
  return host;
}
