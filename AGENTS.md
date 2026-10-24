# Explorer guidelines

Before changing scores, ratings or their tests, read [docs/scoring.md](docs/scoring.md). Derive every score through `modules/scoring.mjs`; do not add scoring formulas to views.

Keep the Explorer tied to the checked, published Dataset snapshot. Fetch a run's own files only when that run is opened.

Make every visible result useful to click. Numbers, models, harnesses, runs, and summaries should open details, a relevant view, or their published source. If something looks clickable, it must lead somewhere useful.

Keep both light and dark themes readable.
