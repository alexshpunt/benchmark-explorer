# Benchmark Explorer

Private source for the public [Benchmark Explorer](https://huggingface.co/spaces/alexshpunt/benchmark-explorer) Space.

The Space reads accepted, generated views from the public [Explicit Edit Benchmark dataset](https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark). Never commit credentials or private benchmark payloads here.

Run `npm run build:snapshot` before serving locally. The build resolves the current Dataset commit, pins every file to that revision, checks published SHA-256 digests, and writes `dist/snapshot.json.gz` and `dist/snapshot-manifest.json`. Serve the app files together with these two files at the web root. The deploy workflow builds and publishes them with the Space.

The browser loads only this checked snapshot. It does not fetch individual run shards. The snapshot contains accepted Dataset views, pre-aggregated run configurations and the compact trial evidence needed for interactive filters, comparisons and tool details. Scores and exclusions still come from the accepted Dataset views; the Space does not edit accepted data.

Summary scores use only runs covering the full published benchmark. Short runs remain visible in version cells and configuration details but have no summary score. The full-benchmark check uses the published benchmark task count, not the smaller task set a run may declare.

Harness card links may use `card=harness:FAMILY@latest`. The Explorer resolves `latest` to the highest accepted semantic version for that harness family.
