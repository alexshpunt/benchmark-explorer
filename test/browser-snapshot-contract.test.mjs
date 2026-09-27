import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("browser fetches the published snapshot rather than individual run shards", async () => {
  const app = await readFile(new URL("../app.mjs", import.meta.url), "utf8");
  assert.match(app, /fetch\("\.\/snapshot-manifest\.json"/);
  assert.match(app, /verifyPublishedBytes\(bytes, manifest\.sha256\)/);
  assert.doesNotMatch(app, /fetch\([^\n]*run\.files|fetchGzipJsonLines|run\.files\[table\]/);
});

test("published page includes every split browser asset", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.mjs", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const styles = [...html.matchAll(/href="\.\/(styles\/[^\"]+\.css)"/g)]
    .map((match) => match[1]);
  const modules = [...app.matchAll(/from "\.\/(modules\/[^\"]+\.mjs)"/g)]
    .map((match) => match[1]);
  assert.ok(styles.length > 0);
  assert.ok(modules.length > 0);
  await Promise.all([...styles, ...modules].map((path) => access(new URL(`../${path}`, import.meta.url))));
  assert.match(workflow, /cp -R modules styles \.space\//);
});