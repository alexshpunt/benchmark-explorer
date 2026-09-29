import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("browser loads one run detail package only through the opened-run path", async () => {
  const app = await readFile(new URL("../app.mjs", import.meta.url), "utf8");
  const details = await readFile(new URL("../modules/details.mjs", import.meta.url), "utf8");
  assert.match(app, /fetch\("\.\/snapshot-manifest\.json"/);
  assert.match(app, /async function loadRunEvidence\(runId\)/);
  assert.match(app, /state\.index\?\.explorerDetails\?\.\[runId\]/);
  assert.match(app, /resolve\/\$\{state\.revision\}\/\$\{file\.path\}/);
  assert.match(app, /verifyPublishedBytes\(bytes, file\.sha256\)/);
  assert.match(details, /async function openRunDetails\(runId\)/);
  assert.match(details, /await loadRunEvidence\(runId\)/);
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

test("summary and run tables keep their intended page order", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const combinations = html.indexOf('data-summary-tab="combinations"');
  const models = html.indexOf('data-summary-tab="models"');
  const matrix = html.indexOf('class="summary-row"');
  const pareto = html.indexOf('class="pareto-panel"');
  const runs = html.indexOf('id="results-view"');
  assert.ok(combinations >= 0 && combinations < models);
  assert.match(html, /data-summary-tab="combinations"[^>]*aria-selected="true"/);
  assert.ok(matrix >= 0 && matrix < pareto && pareto < runs);
});

test("every custom overlay supports light dismiss", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.mjs", import.meta.url), "utf8");
  assert.match(app, /querySelectorAll\("dialog"\)\.forEach\(closeOnOutsideClick\)/);
  assert.match(app, /details\[data-overlay\]\[open\]/);
  assert.match(html, /<details id="column-settings"[^>]*data-overlay/);
});
