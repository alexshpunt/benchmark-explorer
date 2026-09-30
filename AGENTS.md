# Explorer guidelines

## Scoring contract

Use `modules/scoring.mjs` for all derived model, harness, and combination scores. Do not add local scoring formulas to views. Published per-run and per-task scores remain Dataset evidence.

- Only full accepted results with finite scores enter ratings. A real zero is measured data, not missing.
- Select the latest complete harness version separately for each model-provider route. Aggregate repeated runs into one median combination score.
- Model score is the median of its model-harness combination scores. Each harness gets one vote, regardless of repeat count. Merge provider routes for model-family rankings only after route-level version selection.
- Harness score uses `baseline-agent`. M is the fixed set of model-provider routes with complete baseline results in the whole snapshot. Every route has weight 1/|M|.
- Harness score = baseline mean + sum of measured route deltas / |M|. Routes outside M do not contribute. Missing routes contribute delta zero only in totals; source cells stay missing.
- Coverage is measured routes / |M|. Display filters and the baseline-only matrix switch must not redefine M.
- The same harness rating must agree in the leaderboard, matrix, and evidence summaries. Regression tests must cover repeats, missing data, per-route versions, and cross-view agreement.

Keep the Explorer tied to the checked, published Dataset snapshot. Do not load individual run files in the browser.

Make every visible result useful to click. Numbers, models, harnesses, runs, and summaries should open details, a relevant view, or their published source. If something looks clickable, it must lead somewhere useful.

Keep both light and dark themes readable. Check interactive changes in a running browser before calling them done.
