# Benchmark Explorer

Private source for the public [Benchmark Explorer](https://huggingface.co/spaces/alexshpunt/benchmark-explorer) Space.

The Space reads accepted, generated views from the public [Explicit Edit Benchmark dataset](https://huggingface.co/datasets/alexshpunt/explicit-edit-benchmark). Never commit credentials or private benchmark payloads here.

The app resolves `dataset-index.json` from `main`, reads the immutable commit returned by Hugging Face, and pins views and every shard to that commit. Checksums from the index are verified before files are parsed. Scores, exclusions, and policy metadata come from the accepted Dataset views; the Space does not edit accepted data.

Harness card links may use `card=harness:FAMILY@latest`. The Explorer resolves `latest` to the highest accepted semantic version for that harness family.
