import assert from "node:assert/strict";
import test from "node:test";

import {
  datasetRevision,
  pinnedDatasetRoot,
  validateDatasetSnapshot,
  verifyPublishedBytes,
} from "../core.mjs";

const commit = "14d240895ff27aadd22efe9b9a4e1f655f9f76ea";

test("pins every dataset request to the commit returned by Hugging Face", () => {
  const headers = new Headers({ "x-repo-commit": commit });
  assert.equal(datasetRevision(headers), commit);
  assert.equal(
    pinnedDatasetRoot("https://huggingface.co/datasets/a/b", commit),
    `https://huggingface.co/datasets/a/b/resolve/${commit}/`,
  );
  assert.throws(() => datasetRevision(new Headers()), /commit header/);
});

test("rejects incompatible canonical views", () => {
  const index = { schemaVersion: 1, runs: [], views: { sha256: "a".repeat(64) } };
  const views = {
    schemaVersion: 1,
    scoring: { id: "explicit-edit-score", version: 2 },
    leaderboard: [],
    exclusions: { policyId: "benchmark-exclusions-v1", policyRevision: "b".repeat(64) },
  };
  assert.doesNotThrow(() => validateDatasetSnapshot(index, views));
  assert.throws(
    () => validateDatasetSnapshot(index, { ...views, scoring: { ...views.scoring, version: 99 } }),
    /scoring version/,
  );
  assert.throws(
    () => validateDatasetSnapshot(index, { ...views, schemaVersion: 2 }),
    /views schema/,
  );
});

test("checks published bytes before parsing them", async () => {
  const bytes = new TextEncoder().encode("accepted view");
  assert.equal(
    await verifyPublishedBytes(
      bytes,
      "40cd84ab0534f6998d9a6920bce431c541a73424aa9fbb15da1153386c224701",
    ),
    true,
  );
  await assert.rejects(verifyPublishedBytes(bytes, "0".repeat(64)), /checksum/);
});
