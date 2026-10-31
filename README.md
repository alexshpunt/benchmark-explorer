# Benchmark Explorer

[Open Benchmark Explorer](https://huggingface.co/spaces/alexshpunt/benchmark-explorer) to compare models and agent harnesses on precise text-editing tasks from the [Explicit Edit Benchmark](https://github.com/alexshpunt/explicit-edit-benchmark).

The Explorer presents accepted results from the public [benchmark Dataset](https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark). Browse model and harness rankings, compare score, cost and token use, filter the matrix, or open a run to inspect its published evidence. Partial runs remain available in the run details but do not contribute to the complete-run summaries. See [the scoring contract](docs/scoring.md) for the definitions and aggregation rules.

## Data and updates

Each deployment uses a snapshot pinned to a Dataset revision. The build downloads the published Explorer summary, verifies its SHA-256 digest and creates a content-addressed snapshot. The browser uses that snapshot for ordinary navigation. When you open a run, it fetches only that run's evidence from the same Dataset revision and verifies the published checksums.

The deployment workflow checks for Dataset updates and publishes the application and snapshot to the Hugging Face Space. Accepted data and exclusions are maintained in the Dataset, not edited by the Explorer.

## Run locally

Requirements: Node.js and npm, Python 3, and network access to the public Dataset.

```sh
npm ci
npm run build:snapshot
npm run preview
```

Open http://127.0.0.1:8768/. The preview server logs a periodic request to its root page. The snapshot build writes to `dist/`; serve the generated manifest and snapshots with the application files at the web root.

## Checks

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`npm run check` checks JavaScript syntax and runs the Node.js tests. The browser tests use a small checksum-verified snapshot fixture; their artifacts are written to `.tmp/e2e-results/`. The deployment workflow runs both checks before publishing.

## Project structure

- `app.mjs` is the browser entry point; `core.mjs` contains shared data handling.
- `modules/` contains interactive views and scoring logic. `modules/scoring.mjs` owns derived ratings.
- `styles/` contains the styles loaded by `index.html`.
- `scripts/build-snapshot.mjs` builds the revision-pinned snapshot.
- `.github/workflows/deploy.yml` tests and deploys the Space.

Results should lead to their details, a useful filtered view or published evidence. Keep the Explorer tied to the checked Dataset snapshot and fetch a run's files only when that run is opened.
