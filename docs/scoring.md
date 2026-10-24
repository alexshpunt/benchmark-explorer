# Scoring contract

`modules/scoring.mjs` computes every derived model, harness, and combination score. Views do not have their own scoring formulas. Published per-run and per-task scores remain Dataset evidence.

- Only full accepted results with finite scores enter ratings. A real zero is measured data, not missing.
- A rated model is model family × reasoning. Exact comparison routes are model family × provider × reasoning. Missing reasoning is `unspecified`, never inferred as `off`.
- The latest complete harness version is selected separately for each exact route. Repeated runs aggregate into one median combination score.
- Model score is the median of its model-harness combination scores. Each harness gets one vote, regardless of repeat count. Providers merge only within the same model × reasoning, after exact-route version selection. Reasoning modes never merge in model ratings.
- Harness score uses `baseline-agent`. M is the fixed set of model-provider-reasoning routes with complete baseline results in the whole snapshot. Every route has weight 1/|M|.
- Harness score = baseline mean + sum of measured route deltas / |M|. Routes outside M do not contribute. Missing routes contribute delta zero only in totals; source cells stay missing.
- Coverage is measured routes / |M|. Display filters and the baseline-only matrix switch do not redefine M.
- A harness rating agrees across the leaderboard, matrix, and evidence summaries.

Regression tests cover repeats, missing data, per-route versions, mismatched reasoning, and cross-view agreement. Repeatable browser e2e checks the same contract.
