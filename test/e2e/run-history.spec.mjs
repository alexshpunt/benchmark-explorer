import { test, expect } from "@playwright/test";
import { snapshotFixture } from "./snapshot-fixture.mjs";

const { bytes, manifest } = snapshotFixture([
  ["baseline", "baseline-agent", "1", "high", 5],
  ["old-zero", "h", "1", "high", 0], ["new", "h", "2", "high", 8],
  ["repeat", "h", "2", "high", 8], ["undated", "h", "2", "high", 8],
  ["partial", "h", "3", "high", 10, 1], ["other-mode", "h", "2", "low", 6],
], snapshot => {
  snapshot.acceptedRuns = snapshot.acceptedRuns.map(run => ({ ...run,
    acceptedAt: run.runId === "undated" ? null : run.runId === "old-zero" ? "2026-09-01T00:00:00Z" : "2026-10-01T00:00:00Z" }));
});
const dialog = page => page.locator("#cell-details");
const history = page => dialog(page).locator(".run-history");
const series = page => history(page).locator('.history-series[data-series-label="p / m · high · h"]');
const runList = page => history(page).locator('.history-runs[data-series-label="p / m · high · h"]');

test("all history series share one date axis, with distinct colors and a matching legend", async ({ page }, testInfo) => {
  await page.goto("/?reasoning=high");
  await page.locator('[data-summary-tab="models"]').click();
  await page.locator('[data-summary-grid="models"]').getByRole("button", { name: "m · high", exact: true }).click();
  const chart = dialog(page).locator(".configuration-history");
  await expect(chart.locator("svg")).toHaveCount(1);
  await expect(chart.locator(".history-line")).toHaveCount(2);
  await expect(chart.locator(".history-legend button")).toHaveText(["p / m · high · baseline-agent", "p / m · high · h"]);
  const colors = await chart.locator(".history-line").evaluateAll(lines => lines.map(line => getComputedStyle(line).stroke));
  expect(new Set(colors).size).toBe(2);
  const swatches = await chart.locator(".history-swatch").evaluateAll(items => items.map(item => getComputedStyle(item).backgroundColor));
  expect(swatches).toEqual(colors);
  await expect(chart.locator('[data-run-id="baseline"]')).toHaveAttribute("cx", await chart.locator('[data-run-id="new"]').getAttribute("cx"));
  await chart.locator(".history-legend button").nth(1).click();
  await expect(chart.locator("details").nth(1)).toHaveAttribute("open", "");
  await page.screenshot({ path: testInfo.outputPath("shared-history.png") });
});
test.beforeEach(async ({ page }) => {
  await page.route("**/snapshot-manifest.json", route => route.fulfill({ json: manifest }));
  await page.route("**/snapshots/*.json.gz", route => route.fulfill({ body: bytes, contentType: "application/gzip" }));
});

test("model and harness details restore history, dates, and zero without changing ratings", async ({ page }, testInfo) => {
  await page.goto("/?reasoning=high");
  await page.locator('[data-summary-tab="models"]').click();
  const model = page.locator('[data-summary-grid="models"] tbody tr');
  await expect(model.locator('[data-column-id="score"]')).toHaveText("65");
  await model.getByRole("button", { name: "m · high", exact: true }).click();
  await expect(dialog(page).getByRole("columnheader", { name: "Published (UTC)", exact: true })).toBeVisible();
  await expect(series(page).locator(".run-history-point")).toHaveCount(3);
  await expect(series(page).locator('[data-run-id="old-zero"]')).toHaveAttribute("aria-label", /: 0.0, published Sep 1, 2026/);
  await expect(history(page)).toContainText("1 full result has no publication date");
  await expect(dialog(page).locator(".configuration-history")).not.toContainText("other-mode");
  await runList(page).locator("summary").click();
  await expect(runList(page).locator("li")).toHaveCount(5);
  await expect(history(page)).toContainText("Sep 1, 2026 · 0.0 · h 1 · old-zero");
  await expect(history(page)).toContainText("Unavailable · 80.0 · h 2 · undated");
  await page.screenshot({ path: testInfo.outputPath("model-history.png") });
  expect(await dialog(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await series(page).locator('[data-run-id="old-zero"]').press("Enter");
  await expect(page.locator("#cell-details-title")).toHaveText("Run: old-zero");
  await expect(dialog(page).locator(".run-history-point")).toHaveCount(1);
  await expect(dialog(page)).not.toContainText("repeat");
  await page.getByRole("button", { name: "Close details", exact: true }).click();
  await expect(model.locator('[data-column-id="score"]')).toHaveText("65");
  await page.locator('.matrix-table thead .matrix-header').filter({ has: page.locator('.matrix-header-label', { hasText: /^h$/ }) }).click();
  await expect(series(page).locator(".run-history-point")).toHaveCount(3);
});

test("comparison selection has dated history and same-date repeats stay individually inspectable", async ({ page }) => {
  await page.goto("/?reasoning=high");
  const route = page.locator(".matrix-table tbody tr").filter({ has: page.locator(".matrix-header-label", { hasText: "p / m · high" }) });
  await route.locator('.matrix-cell').nth(1).click();
  await page.locator("#task-families .selection-model").click();
  await expect(series(page).locator(".run-history-point")).toHaveCount(3);
  await runList(page).locator("summary").click();
  await runList(page).getByRole("button", { name: /Oct 1, 2026 · 80.0 · h 2 · repeat$/ }).click();
  await expect(page.locator("#cell-details-title")).toHaveText("Run: repeat");
  await expect(dialog(page).locator(".run-history-point")).toHaveCount(1);
  await expect(dialog(page)).toContainText("Oct 1, 2026");
});
