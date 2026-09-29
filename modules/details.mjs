import {
  aggregateGroupScore, canonicalModelFamily, describeDistribution,
  modelRouteIdentity, modelRouteLabel, precomputedFamilyScore, taskFamily, toolTrialCounts,
} from "../core.mjs";
import { compactVersion } from "./comparison.mjs";

/** Create the shared cards and detail-dialog helpers. */
export function createDetails(state, {
  DATASET_PAGE, percentText, mean, scopeToken, configToken, setCard,
  selectedValues, activeFilters, render, syncUrl, rowsForCell, cellKeyFromRow,
  COLUMN_BY_ID, loadRunEvidence, pooledFamilyScore,
}) {
  function formatNumber(value, decimals) {
    return decimals ? value.toFixed(decimals) : Math.round(value).toLocaleString();
  }

  function detailList(entries) {
    const list = document.createElement("dl");
    list.className = "details-metrics";
    for (const [term, value] of entries) {
      const item = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      item.append(dt, dd);
      list.append(item);
    }
    return list;
  }

  function detailsSection(title) {
    const section = document.createElement("section");
    section.className = "details-section";
    const heading = document.createElement("h3");
    heading.textContent = title;
    section.append(heading);
    return section;
  }

  /**
   * Render a details table. An entry may be a plain array of cells, or an object
   * with an onClick; the first cell then becomes a button, so every listed thing
   * can be opened in turn and the reader can keep drilling down.
   */
  function detailTable(headers, entries) {
    const table = document.createElement("table");
    table.className = "details-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const header of headers) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = header;
      headRow.append(th);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const entry of entries) {
      const cells = Array.isArray(entry) ? entry : entry.cells;
      const onClick = Array.isArray(entry) ? null : entry.onClick;
      const row = document.createElement("tr");
      cells.forEach((value, index) => {
        const cell = document.createElement(index === 0 ? "th" : "td");
        if (index === 0) {
          cell.scope = "row";
          if (onClick) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "details-link";
            button.textContent = value;
            button.addEventListener("click", onClick);
            cell.append(button);
          } else {
            cell.textContent = value;
          }
        } else {
          cell.textContent = value;
        }
        row.append(cell);
      });
      body.append(row);
    }
    table.append(head, body);
    return table;
  }

  /** Show a quantile strip so spread is visible instead of only an average. */
  function distributionBlock(sample) {
    const summary = describeDistribution(sample.values);
    if (!summary) return null;
    const section = detailsSection(sample.label);
    const span = summary.max - summary.min || 1;
    const position = (value) => ((value - summary.min) / span) * 100;
    const track = document.createElement("div");
    track.className = "distribution-track";
    const band = document.createElement("i");
    band.className = "distribution-band";
    band.style.left = `${position(summary.p25).toFixed(2)}%`;
    band.style.width = `${Math.max(1, position(summary.p75) - position(summary.p25)).toFixed(2)}%`;
    const median = document.createElement("i");
    median.className = "distribution-median";
    median.style.left = `${position(summary.median).toFixed(2)}%`;
    track.append(band, median);
    const text = (value) => `${formatNumber(value, sample.decimals)}${sample.unit}`;
    const legend = document.createElement("p");
    legend.className = "distribution-legend";
    legend.textContent = `min ${text(summary.min)} · p25 ${text(summary.p25)} · median ${text(summary.median)} · p75 ${text(summary.p75)} · max ${text(summary.max)} · mean ${text(summary.mean)} · ${summary.count} observations`;
    section.append(
      track,
      legend,
      detailList([
        ["Minimum", text(summary.min)],
        ["Median", text(summary.median)],
        ["Maximum", text(summary.max)],
        ["Mean", text(summary.mean)],
      ]),
    );
    return section;
  }

  /**
   * Close the dialog when the click lands outside it. The click target is the
   * dialog itself for the backdrop, so the coordinates decide whether the press
   * was really outside the panel or just on its padding.
   */
  function closeOnOutsideClick(dialog) {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if (!inside) dialog.close();
    });
  }

  /**
   * Render one line of the card header. A part without an opener is plain text,
   * so a card always shows what it is made of and links to each piece.
   */
  function renderHeaderParts(host, parts) {
    host.replaceChildren();
    const list = typeof parts === "string" ? [{ text: parts }] : (parts ?? []);
    const visible = list.filter((part) => part.text);
    host.hidden = visible.length === 0;
    visible.forEach((part, index) => {
      if (index) host.append(" · ");
      if (!part.onClick) {
        host.append(part.text);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "details-link";
      button.textContent = part.text;
      button.title = `Open ${part.text}`;
      button.addEventListener("click", part.onClick);
      host.append(button);
    });
  }

  /**
   * One dialog serves every clickable element in the explorer. Following a link
   * inside an open dialog replaces its content instead of re-opening it.
   */
  function openDetailsDialog(title, identity, sections) {
    const dialog = document.querySelector("#cell-details");
    renderHeaderParts(document.querySelector("#cell-details-title"), title);
    renderHeaderParts(document.querySelector("#cell-details-identity"), identity);
    document.querySelector("#cell-details-body").replaceChildren(...sections.filter(Boolean));
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }

  /** Link to a published file, opened in a new tab. */
  function datasetLink(path, text, title = "") {
    const link = document.createElement("a");
    const revision = state.revision ?? "main";
    link.href = DATASET_PAGE + "/" + path.replace("blob/main/", "blob/" + revision + "/").replace("tree/main/", "tree/" + revision + "/");
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${text} ↗`;
    if (title) link.title = title;
    return link;
  }

  /**
   * Provenance of the source submissions and runs behind a set of rows. Every
   * entry links to the published file it names, so a reader can check a number
   * instead of trusting it.
   */
  function provenanceSection(rows) {
    const submissions = [...new Set(rows.flatMap((row) => row.submissionIds ?? []))].sort();
    const runIds = [...new Set(rows.flatMap((row) => row.runIds ?? []))].sort();
    const section = detailsSection("Provenance");
    const list = document.createElement("ul");
    list.className = "details-sources";
    for (const runId of runIds) {
      const run = state.index?.runs?.find((entry) => entry.runId === runId);
      const item = document.createElement("li");
      // The dataset index names the shards of each run, so the link is a real
      // file instead of a guessed URL pattern.
      const trials = run?.files?.trials?.path;
      item.append(
        trials
          ? datasetLink(
              `blob/main/${trials}`,
              runId,
              `Trial results of this run on Hugging Face: ${trials}`,
            )
          : runId,
      );
      const counts = run?.counts;
      if (counts) {
        const note = document.createElement("p");
        note.className = "details-note";
        note.textContent = `${counts.trials.toLocaleString()} trials · ${counts.rounds.toLocaleString()} rounds · ${counts.toolCalls.toLocaleString()} tool calls`;
        item.append(note);
      }
      const provenance = document.createElement("p");
      provenance.className = "details-note";
      const verification = run?.verification ?? "unverified";
      const execution = run?.official?.executionId ? ` · execution ${run.official.executionId}` : "";
      provenance.textContent = `${verification}${execution}`;
      item.append(provenance);
      if (run?.submittedBy?.profileUrl) {
        const submitter = document.createElement("p");
        submitter.className = "details-note";
        submitter.append("Submitted by ");
        const profile = document.createElement("a");
        profile.href = run.submittedBy.profileUrl;
        profile.target = "_blank";
        profile.rel = "noreferrer";
        profile.textContent = `@${run.submittedBy.accountId} ↗`;
        submitter.append(profile);
        item.append(submitter);
      }
      if (run?.official?.proofPath) {
        item.append(
          datasetLink(
            `tree/main/${run.official.proofPath}`,
            "Official proof",
            "Signed result, attestation, and acceptance receipt",
          ),
        );
      }
      list.append(item);
    }
    for (const submissionId of submissions) {
      const item = document.createElement("li");
      item.append(
        datasetLink(
          `tree/main/source/accepted/${submissionId}`,
          `Bundle ${submissionId.slice(0, 12)}…`,
          `Accepted bundle folder of ${submissionId}`,
        ),
      );
      list.append(item);
    }
    section.append(list);
    return section;
  }

  /** Score spread and the configurations behind a model, harness or cell. */
  function configurationListSection(rows, title) {
    const section = detailsSection(`${title} (${rows.length})`);
    const summary = describeDistribution(rows.filter((row) => row.fullBenchmark)
      .map((row) => row.score * 100));
    if (summary) {
      const line = document.createElement("p");
      line.textContent = `Score across them: min ${summary.min.toFixed(1)} · median ${summary.median.toFixed(1)} · max ${summary.max.toFixed(1)}.`;
      section.append(line);
    }
    section.append(
      detailTable(
        ["Configuration", "Score", "Trials"],
        rows
          .toSorted((left, right) => Number(right.fullBenchmark) - Number(left.fullBenchmark) ||
            (right.fullBenchmark ? right.score - left.score : right.taskCount - left.taskCount))
          .map((row) => ({
            cells: [
              configurationLabel(row),
              row.fullBenchmark ? (row.score * 100).toFixed(3) : "— (partial)",
              row.observations.toLocaleString(),
            ],
            onClick: () => openConfigurationDetails([row]),
          })),
      ),
    );
    return section;
  }

  /** One line that names a configuration in lists and dialogs. */
  function configurationLabel(row) {
    return `${modelRouteLabel(row)} · ${row.harnessFamily} ${compactVersion(row.harnessVersion)} · ${row.thinking ?? "unknown"}`;
  }

  /**
   * Per-task outcomes: which benchmark tests actually passed. Family totals are
   * always shown, and the full task list appears when one configuration is open.
   */
  function taskOutcomeSection(rows) {
    const tasks = [];
    for (const row of rows) {
      const byTask = new Map();
      for (const sample of row.trialSamples ?? []) {
        const item = byTask.get(sample.taskId) ?? { trials: 0, first: 0, final: 0 };
        item.trials += 1;
        item.first += Number(sample.firstExactPassed);
        item.final += Number(sample.finalExactPassed);
        byTask.set(sample.taskId, item);
      }
      for (const [taskId, item] of byTask) {
        tasks.push({
          taskId,
          family: taskFamily(taskId),
          trials: item.trials,
          first: item.first / item.trials,
          final: item.final / item.trials,
        });
      }
    }
    if (!tasks.length) return null;

    const families = new Map();
    for (const task of tasks) {
      const entry = families.get(task.family) ?? { tasks: 0, first: 0, final: 0 };
      entry.tasks += 1;
      entry.first += task.first;
      entry.final += task.final;
      families.set(task.family, entry);
    }
    const perFamily = [...families]
      .map(([family, entry]) => ({
        family,
        tasks: entry.tasks,
        first: entry.first / entry.tasks,
        final: entry.final / entry.tasks,
      }))
      .toSorted((left, right) => left.first - right.first || left.family.localeCompare(right.family));

    // Several configurations repeat the same task, so the unit is named honestly.
    const unit = rows.length > 1 ? "task observations" : "tasks";
    const missed = tasks.filter((task) => task.final < 1).length;
    const recovered = tasks.filter((task) => task.first < 1 && task.final === 1).length;
    const section = detailsSection(`Task outcomes (${tasks.length} ${unit})`);
    const line = document.createElement("p");
    line.textContent = `${tasks.length - missed} of ${tasks.length} ${unit} ended byte-exact; ${recovered} of them only after recovery. Worst families first.`;
    section.append(
      line,
      detailTable(
        ["Task family", rows.length > 1 ? "Observations" : "Tasks", "First exact", "Final exact"],
        perFamily.map((entry) => ({
          cells: [
            entry.family,
            String(entry.tasks),
            percentText(entry.first),
            percentText(entry.final),
          ],
          onClick: () => openTaskFamilyDetails(entry.family, rows),
        })),
      ),
    );
    if (rows.length === 1) {
      const scroll = document.createElement("div");
      scroll.className = "details-scroll";
      scroll.append(
        detailTable(
          ["Task", "Trials", "First", "Final"],
          tasks
            .toSorted(
              (left, right) => left.final - right.final || left.taskId.localeCompare(right.taskId),
            )
            .map((task) => ({
              cells: [
                task.taskId,
                String(task.trials),
                task.first === 1 ? "pass" : "miss",
                task.final === 1 ? "pass" : "miss",
              ],
              onClick: () => openTaskDetails(task.taskId, rows),
            })),
        ),
      );
      section.append(scroll);
    }
    return section;
  }

  /** Buttons that narrow the whole page to one value. */
  function actionsSection(actions) {
    const section = document.createElement("div");
    section.className = "details-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        for (const [name, value] of action.filters) if (value) selectedValues(name).add(value);
        state.selected.clear();
        document.querySelector("#cell-details").close();
        render();
        syncUrl();
      });
      section.append(button);
    }
    return section;
  }

  /** Clickable parts of one configuration: model, agent, harness and reasoning. */
  function identityParts(row) {
    const model = modelRouteLabel(row);
    const route = modelRouteIdentity(row);
    return [
      { text: model, onClick: () => openModelDetails(route) },
      ...(row.agentFamily
        ? [{ text: row.agentFamily, onClick: () => openAgentDetails(row.agentFamily) }]
        : []),
      {
        text: `${row.harnessFamily} ${compactVersion(row.harnessVersion)}`,
        onClick: () => openHarnessDetails(row.harnessFamily, row.harnessVersion),
      },
      ...(row.thinking
        ? [{ text: `thinking ${row.thinking}`, onClick: () => openThinkingDetails(row.thinking) }]
        : []),
    ];
  }

  /** Clickable identity parts shared by every row in a configuration scope. */
  function configurationScopeParts(rows) {
    const [first] = rows;
    const same = (pick) => rows.every((row) => pick(row) === pick(first));
    const parts = [];
    const model = modelRouteLabel(first);
    const route = modelRouteIdentity(first);
    if (same(modelRouteIdentity)) {
      parts.push({ text: model, onClick: () => openModelDetails(route) });
    }
    if (first.agentFamily && same((row) => row.agentFamily)) {
      parts.push({ text: first.agentFamily, onClick: () => openAgentDetails(first.agentFamily) });
    }
    if (same((row) => row.harnessFamily) && same((row) => row.harnessVersion)) {
      parts.push({
        text: `${first.harnessFamily} ${compactVersion(first.harnessVersion)}`,
        onClick: () => openHarnessDetails(first.harnessFamily, first.harnessVersion),
      });
    }
    if (first.thinking && same((row) => row.thinking)) {
      parts.push({
        text: `thinking ${first.thinking}`,
        onClick: () => openThinkingDetails(first.thinking),
      });
    }
    return parts.length ? parts : "Configuration selection";
  }

  /** Rows visible under the current filters that belong to one model route. */
  function rowsForModel(route) {
    return state.configurations.filter((row) => modelRouteIdentity(row) === route);
  }

  function rowsForHarness(harness, version) {
    return state.configurations.filter(
      (row) => row.harnessFamily === harness && (version == null || row.harnessVersion === version),
    );
  }

  function rowsForAgent(agent) {
    return state.configurations.filter((row) => row.agentFamily === agent);
  }

  function rowsForThinking(thinking) {
    return state.configurations.filter((row) => row.thinking === thinking);
  }

  const totalTrials = (rows) =>
    rows.reduce((total, row) => total + row.observations, 0).toLocaleString();
  /** Score, coverage and measured share of one group of configurations. */
  function groupSummary(rows) {
    const group = aggregateGroupScore(rows);
    return [
      ["Score", group.score == null ? "—" : (group.score * 100).toFixed(1)],
      ["Coverage", percentText(group.coverage)],
      ["Tasks measured", `${group.taskCount} of ${group.benchmarkTaskCount}`],
    ];
  }

  function sourceLinksSection(links) {
    const entries = Object.entries(links ?? {}).filter(([, url]) => url);
    if (!entries.length) return null;
    const section = detailsSection("Sources");
    const list = document.createElement("ul");
    for (const [label, url] of entries) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `${label} ↗`;
      item.append(link);
      list.append(item);
    }
    section.append(list);
    return section;
  }

  /**
   * One identity value — a model, an agent, a harness or a reasoning mode — with
   * every configuration behind it, its task outcomes and its provenance.
   */
  function openGroupDetails({ kind, card, title, identity, note, summary, rows, filters, links }) {
    const section = detailsSection("How this value is computed");
    const paragraph = document.createElement("p");
    paragraph.textContent = note;
    const formula = document.createElement("p");
    formula.textContent =
      "Only runs covering the full benchmark count toward the summary score. Partial runs stay visible in the configurations below.";
    section.append(paragraph, formula, detailList(summary));
    setCard(card);
    const sources = sourceLinksSection(links);
    openDetailsDialog(title, identity, [
      section,
      ...(sources ? [sources] : []),
      configurationListSection(rows, "Visible configurations"),
      taskOutcomeSection(rows),
      provenanceSection(rows),
      actionsSection([{ label: `Filter table to this ${kind}`, filters }]),
    ]);
  }

  /** Everything worth knowing about one configuration. */
  function openConfigurationDetails(rows) {
    const [first] = rows;
    if (!first) return;
    const single = rows.length === 1 ? first : null;
    const sections = [];
    if (single) {
      sections.push(
        (() => {
          const section = detailsSection("How this value is computed");
          const paragraph = document.createElement("p");
          paragraph.textContent = single.fullBenchmark
            ? "Score = coverage × (0.75 × first exact rate + 0.25 × final exact rate)."
            : "This run is incomplete. Its task outcomes are available below, but it has no benchmark score.";
          section.append(
            paragraph,
            detailList([
              ["Coverage", percentText(single.coverage)],
              ...(single.fullBenchmark ? [["Quality score", percentText(single.qualityScore)]] : []),
              ["First exact rate", percentText(single.firstExactRate)],
              ["Final exact rate", percentText(single.finalExactRate)],
              ["Trials", single.observations.toLocaleString()],
              ["Recovery rounds", single.recoveryRounds.toLocaleString()],
            ]),
          );
          return section;
        })(),
      );
    } else {
      sections.push(configurationListSection(rows, "Configurations in this selection"));
    }
    sections.push(taskOutcomeSection(rows), provenanceSection(rows));
    sections.push(
      actionsSection([
        {
          label: `Filter table to this ${single ? "configuration" : "model and harness"}`,
          filters: [
            ["model", canonicalModelFamily(first.modelFamily)],
            ["provider", first.provider ?? "unknown"],
            ["harness", first.harnessFamily],
            ...(first.harnessVersion
              ? [["harnessVersion", `${first.harnessFamily}\t${first.harnessVersion}`]]
              : []),
          ],
        },
      ]),
    );
    // One shared identity renderer prevents callers from inventing a second,
    // conflicting title for the same configuration scope.
    openDetailsDialog(
      single ? identityParts(first) : configurationScopeParts(rows),
      single ? null : `${rows.length} configurations`,
      sections,
    );
    setCard(`config:${scopeToken(rows)}`);
  }

  /** A published run, including configurations hidden by the current filters. */
  async function openRunDetails(runId) {
    const run = state.index?.runs?.find((entry) => entry.runId === runId);
    const rows = state.snapshot?.runRows?.all?.filter((row) => row.runId === runId) ?? [];
    if (!run || !rows.length) return;
    const card = `run:${runId}`;
    const subtitle = `${rows.length} configurations · ${run.counts.trials.toLocaleString()} trials`;
    const loading = detailsSection("Run evidence");
    const loadingText = document.createElement("p");
    loadingText.textContent = "Loading this run’s verified rounds and tool calls…";
    loading.append(loadingText);
    openDetailsDialog(`Run: ${runId}`, subtitle, [
      configurationListSection(rows, "Configurations in this run"),
      taskOutcomeSection(rows),
      loading,
      provenanceSection(rows),
    ]);
    setCard(card);
    try {
      const evidence = await loadRunEvidence(runId);
      if (state.card !== card) return;
      const tools = new Map();
      for (const call of evidence.toolCalls) {
        if (call.tool) tools.set(call.tool, (tools.get(call.tool) ?? 0) + 1);
      }
      const evidenceSection = detailsSection("Verified run evidence");
      evidenceSection.append(
        detailList([
          ["Profiles", evidence.profiles.length.toLocaleString()],
          ["Trials", evidence.trials.length.toLocaleString()],
          ["Rounds", evidence.rounds.length.toLocaleString()],
          ["Tool calls", evidence.toolCalls.length.toLocaleString()],
          [
            "Most used tools",
            [...tools]
              .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
              .slice(0, 5)
              .map(([tool, calls]) => `${tool} (${calls.toLocaleString()})`)
              .join(", ") || "—",
          ],
        ]),
      );
      openDetailsDialog(`Run: ${runId}`, subtitle, [
        configurationListSection(rows, "Configurations in this run"),
        taskOutcomeSection(rows),
        evidenceSection,
        provenanceSection(rows),
      ]);
    } catch (error) {
      if (state.card !== card) return;
      const failure = detailsSection("Run evidence unavailable");
      const message = document.createElement("p");
      message.textContent = "The run’s detailed files could not be verified. Try again later.";
      failure.append(message);
      openDetailsDialog(`Run: ${runId}`, subtitle, [
        configurationListSection(rows, "Configurations in this run"),
        taskOutcomeSection(rows),
        failure,
        provenanceSection(rows),
      ]);
      console.error(error);
    }
  }
  /** One model route: every visible configuration it ran, plus its task outcomes. */
  function openModelDetails(route) {
    const rows = rowsForModel(route);
    if (!rows.length) return;
    const [model, provider] = route.split("\t");
    openGroupDetails({
      kind: "model route",
      card: `model:${model}|${provider}`,
      title: `Model route: ${model} · ${provider}`,
      identity: `Provider ${provider}`,
      note: "Every accepted configuration recorded for this model route under the current filters. The ranking score pools its trials task by task without mixing another provider serving the same model family.",
      summary: [
        ["Model family", model],
        ["Provider", provider],
        ["Configurations", String(rows.length)],
        ["Harnesses", String(new Set(rows.map((row) => row.harnessFamily)).size)],
        ["Trials", totalTrials(rows)],
        ...groupSummary(rows),
      ],
      rows,
      links: { "Official model page": state.views?.sources?.models?.[model]?.officialPageUrl },
      filters: [
        ["model", model],
        ["provider", provider],
      ],
    });
  }

  /** One agent or CLI across every model it drove. */
  function openAgentDetails(agent) {
    const rows = rowsForAgent(agent);
    if (!rows.length) return;
    const [first] = rows;
    openGroupDetails({
      kind: "agent",
      card: `agent:${agent}`,
      title: `Agent: ${agent}`,
      identity: first?.agentVersion ? `Version ${first.agentVersion}` : "Agent or CLI",
      note: "The agent is the client that talked to the model. Comparing agents separates model quality from prompt and control-loop design.",
      summary: [
        ["Agent", agent],
        ["Agent version", first?.agentVersion ?? "—"],
        ["Configurations", String(rows.length)],
        ["Model routes", String(new Set(rows.map(modelRouteIdentity)).size)],
        ["Trials", totalTrials(rows)],
        ...groupSummary(rows),
      ],
      rows,
      filters: [["agent", agent]],
    });
  }

  /** One reasoning mode across every configuration that requested it. */
  function openThinkingDetails(thinking) {
    const rows = rowsForThinking(thinking);
    if (!rows.length) return;
    openGroupDetails({
      kind: "thinking mode",
      card: `thinking:${thinking}`,
      title: `Thinking: ${thinking}`,
      identity: "Requested reasoning level",
      note: "The reasoning level requested from the model. When reasoning is not fixed by a filter, accepted modes are rolled into one configuration.",
      summary: [
        ["Thinking", thinking],
        ["Configurations", String(rows.length)],
        ["Harnesses", String(new Set(rows.map((row) => row.harnessFamily)).size)],
        ["Trials", totalTrials(rows)],
        ...groupSummary(rows),
      ],
      rows,
      filters: [["reasoning", thinking]],
    });
  }

  /** One harness or one harness version across every model that ran it. */
  function openHarnessDetails(harness, version) {
    const rows = rowsForHarness(harness, version);
    if (!rows.length) return;
    const source = state.views?.sources?.harnesses?.[harness];
    const packageUrl =
      source?.packageUrl && version
        ? `${source.packageUrl}/v/${encodeURIComponent(version)}`
        : source?.packageUrl;
    const family = state.views?.badges?.harnessFamily?.[harness];
    const summary = groupSummary(rows);
    const badgeVersion = family?.harnessVersion
      ? compactVersion(family.harnessVersion)
      : "no complete version";
    const badgeSummary = [
      `Badge score (latest complete: ${badgeVersion})`,
      family?.score == null ? "—" : (family.score * 100).toFixed(1),
    ];
    if (version) {
      summary[0][0] = "Version score";
      summary.unshift(badgeSummary);
    } else {
      summary[0] = badgeSummary;
    }
    openGroupDetails({
      kind: "harness",
      card: `harness:${harness}@${version ?? ""}`,
      title: `Harness: ${harness}`,
      identity: version ? `Version ${compactVersion(version)}` : "All visible versions",
      note: version
        ? "The badge reports the newest harness version with a complete benchmark run. Partial-only versions are ignored. This card also shows the selected version score."
        : "The badge reports the newest harness version with a complete benchmark run. Partial-only versions are ignored.",
      summary: [
        ["Harness", harness],
        ["Version", version ?? "all visible versions"],
        ["Configurations", String(rows.length)],
        ["Model routes", String(new Set(rows.map(modelRouteIdentity)).size)],
        ["Trials", totalTrials(rows)],
        ...summary,
      ],
      rows,
      links: { Repository: source?.repositoryUrl, "npm package": packageUrl },
      filters: [
        ["harness", harness],
        ...(version ? [["harnessVersion", `${harness}\t${version}`]] : []),
      ],
    });
  }

  /** Official family score for one configuration, from the shared aggregation. */
  function familyScore(row, family) {
    return precomputedFamilyScore(row, family);
  }

  /** Per-task rates of one family, read from the trial samples already loaded. */
  function familyTasks(rows, family) {
    const byTask = new Map();
    for (const row of rows) {
      for (const sample of row.trialSamples ?? []) {
        if (taskFamily(sample.taskId) !== family) continue;
        const item = byTask.get(sample.taskId) ?? { trials: 0, first: 0, final: 0 };
        item.trials += 1;
        item.first += Number(sample.firstExactPassed);
        item.final += Number(sample.finalExactPassed);
        byTask.set(sample.taskId, item);
      }
    }
    return [...byTask].map(([taskId, item]) => ({
      taskId,
      trials: item.trials,
      first: item.first / item.trials,
      final: item.final / item.trials,
    }));
  }

  /** One task family: its tasks, its score, and how other configurations did. */
  function openTaskFamilyDetails(family, rows) {
    const tasks = familyTasks(rows, family);
    if (!tasks.length) return;

    const explain = detailsSection("How this value is computed");
    const paragraph = document.createElement("p");
    paragraph.textContent =
      "The family score uses the same formula as the whole benchmark, but only the tasks of this family: coverage inside the family × (0.75 × first exact rate + 0.25 × final exact rate).";
    const scored = rows
      .filter((row) => row.fullBenchmark)
      .map((row) => ({ row, score: familyScore(row, family) }))
      .filter((entry) => entry.score);
    const [only] = scored;
    explain.append(paragraph);
    if (scored.length === 1 && only) {
      explain.append(
        detailList([
          ["Family score", percentText(only.score.score)],
          ["First exact", percentText(only.score.firstExactRate)],
          ["Final exact", percentText(only.score.finalExactRate)],
          ["Tasks in family", only.score.taskCount.toLocaleString()],
          ["Trials", only.score.observations.toLocaleString()],
        ]),
      );
    } else if (scored.length > 1) {
      // A single configuration's number would be a lie about the whole scope.
      const spread = describeDistribution(scored.map((entry) => entry.score.score * 100));
      const scope = document.createElement("p");
      scope.textContent = `This card covers ${scored.length} configurations, so the numbers below describe the spread across them. Open one configuration for its own family score.`;
      explain.append(
        scope,
        detailList([
          ["Family score", percentText(pooledFamilyScore(rows, family).score)],
          ["Configurations", String(scored.length)],
          ["Median family score", `${spread.median.toFixed(1)}%`],
          ["Best family score", `${spread.max.toFixed(1)}%`],
          ["Worst family score", `${spread.min.toFixed(1)}%`],
          ["Tasks in family", String(tasks.length)],
        ]),
      );
    }

    const list = detailsSection(`Tasks in this family (${tasks.length})`);
    list.append(
      detailTable(
        ["Task", "Trials", "First", "Final"],
        tasks
          .toSorted(
            (left, right) => left.final - right.final || left.taskId.localeCompare(right.taskId),
          )
          .map((task) => ({
            cells: [
              task.taskId,
              String(task.trials),
              task.first === 1 ? "pass" : "miss",
              task.final === 1 ? "pass" : "miss",
            ],
            onClick: () => openTaskDetails(task.taskId, rows),
          })),
      ),
    );

    // Every visible configuration that ran this family, best first.
    const comparison = state.configurations
      .filter((row) => row.fullBenchmark)
      .map((row) => ({ row, score: familyScore(row, family) }))
      .filter((entry) => entry.score)
      .toSorted((left, right) => right.score.score - left.score.score);
    const across = detailsSection(`Across configurations (${comparison.length})`);
    across.append(
      detailTable(
        ["Configuration", "Family score", "Final exact"],
        comparison.map((entry) => ({
          cells: [
            configurationLabel(entry.row),
            percentText(entry.score.score),
            percentText(entry.score.finalExactRate),
          ],
          onClick: () => openConfigurationDetails([entry.row]),
        })),
      ),
    );

    setCard(`family:${family}|${scopeToken(rows)}`);
    openDetailsDialog(
      `Task family: ${family}`,
      rows.length === 1 && rows[0]
        ? identityParts(rows[0])
        : `Family score across ${scored.length || rows.length} configurations`,
      [explain, list, across, provenanceSection(rows)],
    );
  }

  /** One benchmark task: its result here and in every other configuration. */
  function openTaskDetails(taskId, rows) {
    const family = taskFamily(taskId);
    const task = familyTasks(rows, family).find((candidate) => candidate.taskId === taskId);
    if (!task) return;

    const explain = detailsSection("How this value is computed");
    const paragraph = document.createElement("p");
    paragraph.textContent =
      "One trial is one execution of this task. First exact means the workspace matched byte-for-byte before any recovery round; final exact means it matched at the end.";
    explain.append(
      paragraph,
      detailList([
        ["Task", taskId],
        ["Task family", family],
        ["Trials", String(task.trials)],
        ["First exact", percentText(task.first)],
        ["Final exact", percentText(task.final)],
      ]),
    );

    const outcomes = state.configurations
      .flatMap((row) => {
        const samples = (row.trialSamples ?? []).filter((sample) => sample.taskId === taskId);
        if (!samples.length) return [];
        return [
          {
            row,
            first: mean(samples.map((sample) => Number(sample.firstExactPassed))),
            final: mean(samples.map((sample) => Number(sample.finalExactPassed))),
            trials: samples.length,
          },
        ];
      })
      .toSorted((left, right) => right.final - left.final || right.first - left.first);
    const across = detailsSection(`Across configurations (${outcomes.length})`);
    across.append(
      detailTable(
        ["Configuration", "First", "Final", "Trials"],
        outcomes.map((entry) => ({
          cells: [
            configurationLabel(entry.row),
            percentText(entry.first),
            percentText(entry.final),
            String(entry.trials),
          ],
          onClick: () => openConfigurationDetails([entry.row]),
        })),
      ),
    );

    setCard(`task:${taskId}|${scopeToken(rows)}`);
    openDetailsDialog(
      `Task: ${taskId}`,
      rows.length === 1 ? identityParts(rows[0]) : `${rows.length} configurations`,
      [explain, across, provenanceSection(rows)],
    );
  }

  /**
   * One tool: how often it is called, and how that varies between trials.
   * @param {string} tool
   * @param {(Record<string, any> | undefined)[]} rows configurations the card covers
   * @param {boolean} narrowed true when those rows restrict the card to one setup
   */
  function openToolDetails(tool, rows, narrowed) {
    const all = toolTrialCounts(
      state.index,
      state.profiles,
      state.trials,
      state.rounds,
      state.toolCalls,
      tool,
      activeFilters(),
    );
    const keys = narrowed ? new Set(rows.map(cellKeyFromRow)) : null;
    const runIds = narrowed ? new Set(rows.flatMap((row) => row.runId ?? row.runIds ?? [])) : null;
    const scoped = keys
      ? all.filter(
          (entry) => keys.has(entry.key) && (!runIds.size || runIds.has(entry.runId)),
        )
      : all;
    if (!scoped.length) return;
    const calls = scoped.reduce((total, entry) => total + entry.calls, 0);
    const used = scoped.filter((entry) => entry.calls > 0).length;
    const [scopedRow] = narrowed ? rows : [];

    const explain = detailsSection("How this value is computed");
    const paragraph = document.createElement("p");
    paragraph.textContent =
      "Every normalised tool event that named this tool counts once. Trials that never called it stay in the denominator, so the average is honest about how often it is really used.";
    explain.append(
      paragraph,
      detailList([
        ["Calls", calls.toLocaleString()],
        ["Trials", scoped.length.toLocaleString()],
        ["Calls per trial", (calls / scoped.length).toFixed(2)],
        [
          "Trials that used it",
          `${used} of ${scoped.length} (${((used / scoped.length) * 100).toFixed(1)}%)`,
        ],
        ["Observations", String(scoped.length)],
        [
          "Scope",
          scopedRow
            ? `${canonicalModelFamily(scopedRow.modelFamily)} · ${scopedRow.harnessFamily} ${compactVersion(scopedRow.harnessVersion)}`
            : "all visible configurations",
        ],
      ]),
    );

    // Per-configuration popularity, strongest first.
    const byKey = new Map();
    for (const entry of scoped) {
      const group = byKey.get(entry.key) ?? { calls: 0, trials: 0, used: 0 };
      group.calls += entry.calls;
      group.trials += 1;
      group.used += Number(entry.calls > 0);
      byKey.set(entry.key, group);
    }
    const ranked = [...byKey]
      .map(([groupKey, group]) => {
        const [groupModel, groupHarness, groupVersion] = JSON.parse(groupKey);
        return { groupKey, groupModel, groupHarness, groupVersion, ...group };
      })
      .toSorted((left, right) => right.calls / right.trials - left.calls / left.trials);

    const section = detailsSection(`Where it is used (${ranked.length} configurations)`);
    section.append(
      detailTable(
        ["Configuration", "Calls/trial", "Used in", "Calls"],
        ranked.slice(0, 40).map((group) => ({
          cells: [
            `${group.groupModel} · ${group.groupHarness} ${compactVersion(group.groupVersion)}`,
            (group.calls / group.trials).toFixed(2),
            `${group.used}/${group.trials}`,
            group.calls.toLocaleString(),
          ],
          onClick: () => {
            const detailRows = scopedRow?.runId
              ? rows
              : rowsForCell({
                  model: group.groupModel,
                  harness: group.groupHarness,
                  version: group.groupVersion,
                });
            if (detailRows.length) openConfigurationDetails(detailRows);
          },
        })),
      ),
    );

    setCard(`tool:${tool}|${narrowed ? scopeToken(rows) : "all"}`);
    openDetailsDialog(
      `Tool: ${tool}`,
      scopedRow ? identityParts(scopedRow) : "All visible configurations",
      [
        explain,
        distributionBlock({
          values: scoped.map((entry) => entry.calls),
          label: "Calls per trial",
          unit: "",
          decimals: 0,
        }),
        section,
        ...(scopedRow
          ? [
              actionsSection([
                {
                  label: "Filter table to this configuration",
                  filters: [
                    ["model", canonicalModelFamily(scopedRow.modelFamily)],
                    ["harness", scopedRow.harnessFamily],
                    ...(scopedRow.harnessVersion
                      ? [
                          [
                            "harnessVersion",
                            `${scopedRow.harnessFamily}\t${scopedRow.harnessVersion}`,
                          ],
                        ]
                      : []),
                  ],
                },
              ]),
            ]
          : []),
      ],
    );
  }

  /** Open the explanation, spread and provenance behind one clicked cell. */
  function openCellDetails(row, index, columnId) {
    const column = COLUMN_BY_ID.get(columnId);
    if (!column?.detail) return;
    const explain = detailsSection("How this value is computed");
    for (const line of column.detail.lines) {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      explain.append(paragraph);
    }
    explain.append(detailList(column.detail.inputs(row, index)));

    const sample = column.detail.samples?.(row);
    const identity = column.detail.identity?.(row);
    const sections = [explain];
    const distribution = sample ? distributionBlock(sample) : null;
    if (distribution) sections.push(distribution);
    if (identity) {
      sections.push(
        configurationListSection(
          rowsForColumn(column, identity),
          `Visible configurations with this ${column.name.toLowerCase()}`,
        ),
      );
    }
    // The rest of the dialog describes the whole configuration, so a metric click
    // and a configuration click never disagree about the same row.
    sections.push(taskOutcomeSection([row]), provenanceSection([row]));
    if (column.detail.filter) {
      sections.push(
        actionsSection([
          {
            label: `Filter table to this ${column.name.toLowerCase()}`,
            filters: [[column.detail.filter.name, column.detail.filter.value(row)]],
          },
        ]),
      );
    }
    openDetailsDialog(`${column.name}: ${column.cell(row, index)}`, identityParts(row), sections);
    setCard(`metric:${column.id}|${configToken(row)}`);
  }

  /** Rows that share the clicked value in one column. */
  function rowsForColumn(column, identity) {
    return state.configurations.filter((row) => column.detail.identity(row) === identity);
  }

  return { openConfigurationDetails, openRunDetails, openModelDetails, openAgentDetails, openThinkingDetails, openHarnessDetails, openTaskFamilyDetails, openTaskDetails, openToolDetails, openCellDetails, familyScore, formatNumber, closeOnOutsideClick };
}
