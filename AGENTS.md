# Explorer guidelines

## Scoring contract

Use `modules/scoring.mjs` for all derived model, harness, and combination scores. Do not add local scoring formulas to views. Published per-run and per-task scores remain Dataset evidence.

- Only full accepted results with finite scores enter ratings. A real zero is measured data, not missing.
- A rated model is model family × reasoning. Exact comparison routes are model family × provider × reasoning. Missing reasoning is `unspecified`, never inferred as `off`.
- Select the latest complete harness version separately for each exact route. Aggregate repeated runs into one median combination score.
- Model score is the median of its model-harness combination scores. Each harness gets one vote, regardless of repeat count. Merge providers only within the same model × reasoning after exact-route version selection. Never merge reasoning modes in model ratings.
- Harness score uses `baseline-agent`. M is the fixed set of model-provider-reasoning routes with complete baseline results in the whole snapshot. Every route has weight 1/|M|.
- Harness score = baseline mean + sum of measured route deltas / |M|. Routes outside M do not contribute. Missing routes contribute delta zero only in totals; source cells stay missing.
- Coverage is measured routes / |M|. Display filters and the baseline-only matrix switch must not redefine M.
- The same harness rating must agree in the leaderboard, matrix, and evidence summaries. Regression tests must cover repeats, missing data, per-route versions, mismatched reasoning, and cross-view agreement. Repeatable browser e2e must verify the same contract.

Keep the Explorer tied to the checked, published Dataset snapshot. Do not load individual run files in the browser.

Make every visible result useful to click. Numbers, models, harnesses, runs, and summaries should open details, a relevant view, or their published source. If something looks clickable, it must lead somewhere useful.

Keep both light and dark themes readable. Check interactive changes in a running browser before calling them done.
