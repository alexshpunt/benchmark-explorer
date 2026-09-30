import { median, modelRouteIdentity } from "../core.mjs";

/** Robust summary of positive, fully measured totals; percentiles use linear interpolation. */
export function typicalRange(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const percentile = (p) => {
    const position = (sorted.length - 1) * p;
    const low = Math.floor(position);
    return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
  };
  return { median: median(sorted), low: percentile(0.1), high: percentile(0.9), count: sorted.length };
}

/** Snapshot-only community counts and cost/time estimates for full model configurations. */
export function communityOverview(snapshot) {
  const results = new Map();
  for (const row of snapshot.runRows.all) {
    if (!row.fullBenchmark || !Number.isFinite(row.score)) continue;
    const key = JSON.stringify([row.runId, modelRouteIdentity(row), row.harnessFamily,
      row.harnessVersion, row.thinking ?? ""]);
    if (!results.has(key)) results.set(key, row);
  }
  const rows = [...results.values()];
  const measured = (metric) => rows.filter((row) => row.observations > 0 &&
    row[metric]?.observations === row.observations).map((row) => row[metric].total);
  const runs = new Map(snapshot.index.runs.map((run) => [run.runId, run]));
  const people = new Map();
  for (const row of rows) {
    const run = runs.get(row.runId);
    const contributor = run?.submittedBy;
    if (!contributor?.accountId) continue;
    const person = people.get(contributor.accountId) ?? {
      name: contributor.accountId, profileUrl: contributor.profileUrl,
      results: 0, submissions: new Set(), runIds: new Set(),
    };
    person.results++;
    person.runIds.add(row.runId);
    if (run.submissionId) person.submissions.add(run.submissionId);
    people.set(person.name, person);
  }
  return { cost: typicalRange(measured("cost")), duration: typicalRange(measured("duration")),
    contributors: [...people.values()].sort((a, b) => b.results - a.results || a.name.localeCompare(b.name)) };
}

/** Bind header links to one accessible card; shared dialog handling supplies backdrop dismissal. */
export function installCommunityCards() {
  const dialog = document.querySelector("#community-dialog");
  const titles = { participate: "Run the benchmark and contribute", contributors: "Community contributors",
    cost: "Full model run cost", time: "Estimated run time · concurrency 10", method: "What we measure and how scores work", news: "News and what comes next" };
  document.querySelectorAll("[data-community-card]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.communityCard;
      const panel = key === "cost" || key === "time" ? "measurements" : key;
      document.querySelectorAll("[data-community-panel]").forEach((section) => {
        section.hidden = section.dataset.communityPanel !== panel;
      });
      document.querySelector("#community-card-title").textContent = titles[key];
      dialog.showModal();
      dialog.scrollTop = 0;
    });
  });
  document.querySelector("#close-community").addEventListener("click", () => dialog.close());
}
/** Render published estimates and attributed contributors without extra network requests. */
export function renderCommunity(snapshot, openRun) {
  const overview = communityOverview(snapshot);
  const money = (value) => `$${value.toFixed(2)}`;
  const time = (value) => `≈${Math.round(value / 600)} min`;
  for (const [id, data, format] of [["community-cost", overview.cost, money], ["community-time", overview.duration, time]]) {
    const host = document.querySelector(`#${id}`);
    host.textContent = data ? `${format(data.median)} typical · ${format(data.low)}–${format(data.high)}*` : "Not enough measured data";
    host.title = data ? `Median and P10–P90 from ${data.count} fully measured positive results` : "No eligible measurements";
  }
  document.querySelector("#community-samples").textContent =
    `Cost: ${overview.cost?.count ?? 0} results. Time: ${overview.duration?.count ?? 0} results. Run time is estimated as summed task duration ÷ 10, assuming concurrency 10 with all slots busy. It is not measured elapsed time. Uneven task durations, the final tasks, rate limits, and overhead can make real runs take longer. Zeros and incomplete measurements are excluded. P10–P90 omits the outer 10% at each end; it is not a minimum or maximum.`;
  const list = document.querySelector("#community-contributors");
  document.querySelector("#community-summed-time").textContent = overview.duration
    ? `Original summed task time: ${Math.round(overview.duration.median / 60)} min median · ${Math.round(overview.duration.low / 60)}–${Math.round(overview.duration.high / 60)} min P10–P90.`
    : "No fully measured task time available.";
  document.querySelector("#community-people-count").textContent = `${overview.contributors.length} community contributors`;

  list.replaceChildren();
  for (const person of overview.contributors) {
    const item = document.createElement("li");
    const name = document.createElement("a");
    name.textContent = `@${person.name}`;
    name.href = person.profileUrl || `https://github.com/${encodeURIComponent(person.name)}`;
    name.target = "_blank";
    name.rel = "noreferrer";
    const evidence = document.createElement("button");
    evidence.type = "button";
    evidence.textContent = `${person.results} full results · ${person.submissions.size} submissions`;
    evidence.title = "Browse the accepted runs behind this contribution count";
    evidence.addEventListener("click", () => {
      document.querySelector("#community-dialog").close();
      const dialog = document.createElement("dialog");
      dialog.className = "community-run-dialog";
      const heading = document.createElement("h2");
      heading.textContent = `Runs contributed by @${person.name}`;
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Close";
      close.addEventListener("click", () => dialog.close());
      dialog.append(heading, close);
      for (const runId of person.runIds) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = runId;
        button.addEventListener("click", () => { dialog.close(); openRun(runId); });
        dialog.append(button);
      }
      dialog.addEventListener("close", () => dialog.remove());
      dialog.addEventListener("click", (event) => {
        const rect = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
      });
      document.body.append(dialog);
      dialog.showModal();
    });
    item.append(name, evidence);
    list.append(item);
  }
  if (!overview.contributors.length) list.textContent = "No attributed full results in this snapshot yet.";
}
