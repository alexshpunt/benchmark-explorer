import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser fetches the published snapshot rather than individual run shards", async () => {
  const app = await readFile(new URL("../app.mjs", import.meta.url), "utf8");
  assert.match(app, /fetch\("\.\/snapshot-manifest\.json"/);
  assert.match(app, /verifyPublishedBytes\(bytes, manifest\.sha256\)/);
  assert.doesNotMatch(app, /fetch\([^\n]*run\.files|fetchGzipJsonLines|run\.files\[table\]/);
});
