# Benchmark Explorer

Private source for the public [Benchmark Explorer](https://huggingface.co/spaces/alexshpunt/benchmark-explorer) Space.

The Space reads accepted, generated views from the public [Explicit Edit Benchmark dataset](https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark). Never commit credentials or private benchmark payloads here.

Run `npm run build:snapshot` before serving locally. The build resolves the current Dataset commit, pins every file to that revision, checks published SHA-256 digests, and writes `dist/snapshot.json.gz` and `dist/snapshot-manifest.json`. Serve the app files together with these two files at the web root. The deploy workflow builds and publishes them with the Space.

Run `npm run preview` to serve the app at `http://127.0.0.1:8768/`. The preview server requests its own root page every minute and logs the response.

The Explorer is a public leaderboard for comparing how models and harnesses behave on precise text-editing tasks. Its header shows the number of published runs and the latest additions in the pinned Dataset index. Each addition shows its acceptance commit date and the median score of full-benchmark configurations (or a dash if none are full), and opens that run's evidence inside the Explorer. The build reads commit history at the pinned Dataset revision; the browser never fetches it.

The two top-five cards use full runs from the whole snapshot, independent of the active Explorer filters. A model needs three provider–harness routes; a harness needs three model–provider routes. On each route the newest accepted harness version counts once. Model scores first take a median within each provider, then a median across providers. Harness scores use the median across model routes. Full-run price requires observed cost on every trial; missing prices display a dash and do not enter Price or Balance rankings. Balance adds score and price ranks with equal weight among priced entries. Both cards share one ranking control, and their links open filtered Explorer results.

We aim to make every visible result clickable. A number, model, harness, run, or summary should lead to its underlying detail, a useful filtered view, or its published source. Do not make something look interactive unless it goes somewhere useful.

The Pareto chart plots full model-route × harness × reasoning combinations with a fully measured value on the selected horizontal axis: price or total tokens. Prices are never estimated. Each square uses the latest full harness version; distinct runs contribute median score and axis value. A score whisker appears only when repeated runs disagree. A dashed line links measured reasoning levels of the same model route and harness version; the solid line joins non-dominated combinations. Click a square or frontier entry to compare up to four. When squares overlap, the nearby list lets you pick each one. The matrix below also shows results missing a measured price or token count.

The browser entry point is `app.mjs`. Interactive views live in `modules/`: `pareto-data.mjs` builds plotted results and `pareto.mjs` draws the chart, `matrix.mjs` renders grouped scores, `leaderboard.mjs` renders the results table, `comparison.mjs` renders selected-run comparisons, `details.mjs` renders cards and dialogs, `filters.mjs` owns filter menus and table controls, and `top-five.mjs` ranks and renders the two front-page lists. Their matching styles are in `styles/`; `index.html` loads them in cascade order. The deploy workflow publishes both directories with the entry point and snapshot.

In the Score matrix, Across all models compares each harness with pi-default on the same model families. Provider routes are pooled within a model, then the median of the paired score differences is shown in percentage points. At least three shared full-run model families are required; otherwise the cell shows a dash and its pair count. Across all harnesses names the model summary column. Other matrix metrics still show their own medians.

Matrix scores and other measured summaries use only complete benchmark runs. In Score, a cell without a complete run shows a dash and the most complete single run's task count against the published benchmark total (currently 226). Partial runs remain available in details and comparisons, but their scores and measurements do not enter the summaries.

The browser loads only this checked snapshot. It does not fetch individual run shards. The snapshot contains accepted Dataset views, pre-aggregated run configurations and the compact trial evidence needed for interactive filters, comparisons and tool details. Scores and exclusions still come from the accepted Dataset views; the Space does not edit accepted data.

Harness card links may use `card=harness:FAMILY@latest`. The Explorer resolves `latest` to the highest accepted semantic version for that harness family.
