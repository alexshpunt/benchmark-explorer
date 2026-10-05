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

/** Render compact, keyboard-accessible evidence charts with a run list for overlapping points. */
export function renderConfigurationHistory(rows, snapshot, openRun, options) {
  const host = document.createElement("div");
  host.className = "configuration-history";
  for (const group of configurationHistory(rows, snapshot, options)) {
    const figure = document.createElement("figure");
    figure.className = "run-history";
    const caption = document.createElement("figcaption");
    caption.textContent = `${modelRouteLabel(group.row)} · ${group.row.harnessFamily}`;
    figure.append(caption);
    if (group.points.length) {
      const svg = svgNode("svg", { viewBox: "0 0 600 180", role: "group", "aria-label": `Published score history: ${caption.textContent}` });
      const first = group.points[0].time;
      const last = group.points.at(-1).time;
      const x = time => first === last ? 316 : 42 + (time - first) / (last - first) * 548;
      const y = score => 142 - score / 100 * 120;
      for (const score of [0, 50, 100]) {
        svg.append(svgNode("line", { x1: 42, x2: 590, y1: y(score), y2: y(score), class: "history-grid" }),
          svgNode("text", { x: 33, y: y(score) + 4, "text-anchor": "end" }, score));
      }
      svg.append(svgNode("text", { x: 42, y: 12 }, "Score"),
        svgNode("text", { x: first === last ? 316 : 42, y: 166, "text-anchor": first === last ? "middle" : "start" }, dateFormat.format(first)));
      if (last !== first) svg.append(svgNode("text", { x: 590, y: 166, "text-anchor": "end" }, dateFormat.format(last)));
      svg.append(svgNode("polyline", { points: group.points.map(p => `${x(p.time)},${y(p.score)}`).join(" "), class: "history-line" }));
      for (const point of group.points) {
        const label = `${point.row.runId}: ${point.score.toFixed(1)}, published ${dateFormat.format(point.time)}, ${point.row.harnessFamily} ${point.row.harnessVersion ?? "unspecified"}`;
        const circle = svgNode("circle", { cx: x(point.time), cy: y(point.score), r: 5, tabindex: 0, role: "button",
          "aria-label": label, "data-run-id": point.row.runId, class: "run-history-point" });
        circle.append(svgNode("title", {}, label));
        circle.addEventListener("click", () => openRun(point.row.runId));
        circle.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRun(point.row.runId); }
        });
        svg.append(circle);
      }
      figure.append(svg);
    }
    const note = document.createElement("p");
    note.textContent = group.points.length
      ? `Publication date (UTC) · ${group.points.length} full results · select a point or a run below.`
      : "No dated full results to plot.";
    if (group.undated) note.textContent += ` ${group.undated} full ${group.undated === 1 ? "result has" : "results have"} no publication date.`;
    figure.append(note);
    const disclosure = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `Run history (${group.rows.length})`;
    const list = document.createElement("ul");
    const dates = datesFor(snapshot);
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
    host.append(figure);
  }
  return host;
}
