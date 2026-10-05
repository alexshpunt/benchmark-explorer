import { test, expect } from "@playwright/test";
import { snapshotFixture } from "./snapshot-fixture.mjs";

// One checked snapshot with different reasoning versions, repeats, and an unmatched mode.
// Exercise the actual browser loader and all views, without contacting Dataset services.
const cases = [
  ["b-low", "baseline-agent", "1", "low", 4], ["b-high", "baseline-agent", "1", "high", 8],
  ["low-a", "h", "1", "low", 6], ["low-b", "h", "1", "low", 8],
  ["high-old", "h", "1", "high", 1], ["high-new", "h", "2", "high", 9],
  ["unmatched", "h", "2", "xhigh", 10], ["partial", "h", "3", "low", 10, 1],
];
const { bytes, manifest } = snapshotFixture(cases);

const grid = (page, tab) => page.locator(`[data-summary-grid="${tab}"]`);
const rankedRow = (page, tab, label) => {
  const rows = grid(page, tab).locator("tbody tr").filter({ has: page.getByRole("button", { name: label, exact: true }) });
  return tab === "combinations" ? rows.filter({ has: page.getByRole("button", { name: "h", exact: true }) }) : rows;
};
const routeRow = (page, label) => page.locator(".matrix-table tbody tr").filter({ has: page.locator(".matrix-header-label", { hasText: label }) });

async function matrixRating(page, harness) {
  const headers = await page.locator(".matrix-table thead th .matrix-header-label").allTextContents();
  const column = headers.indexOf(harness) + 1;
  expect(column).toBeGreaterThan(0);
  return page.locator(".matrix-across-models td").nth(column - 1).innerText();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/snapshot-manifest.json", (route) => route.fulfill({ json: manifest }));
  await page.route("**/snapshots/*.json.gz", (route) => route.fulfill({ body: bytes, contentType: "application/gzip" }));
});

test("all rankings and matrix match exact reasoning with collapsed groups and repeat medians", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(rankedRow(page, "combinations", "m · low")).toContainText("70");
  await expect(rankedRow(page, "combinations", "m · high")).toContainText("90");
  await expect(rankedRow(page, "combinations", "m · low").locator('[data-column-id="version"]')).toHaveText("1");
  await expect(rankedRow(page, "combinations", "m · high").locator('[data-column-id="version"]')).toHaveText("2");
  await page.locator('[data-summary-tab="models"]').click();
  await expect(rankedRow(page, "models", "m · low").locator('[data-column-id="score"]')).toHaveText("55");
  await expect(rankedRow(page, "models", "m · high").locator('[data-column-id="score"]')).toHaveText("85");
  await expect(grid(page, "models").locator("tbody tr")).toHaveCount(3);
  await page.locator('[data-summary-tab="harnesses"]').click();
  await expect(rankedRow(page, "harnesses", "h").locator('[data-column-id="score"]')).toHaveText("80");
  expect(await matrixRating(page, "h")).toContain("80.0");
  expect(await matrixRating(page, "h")).toContain("2/2 routes");
  await expect(page.locator(".matrix-model-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(routeRow(page, "p / m · low")).toHaveCount(0);
  await page.locator(".matrix-model-toggle").click();
  await expect(routeRow(page, "p / m · low")).toHaveCount(1);
  await expect(routeRow(page, "p / m · high")).toHaveCount(1);
  await expect(routeRow(page, "p / m · xhigh")).toHaveCount(0);
  await expect(routeRow(page, "p / m · low")).toContainText("70.0");
  await expect(routeRow(page, "p / m · high")).toContainText("90.0");
  await page.locator("#matrix-baseline-only").uncheck();
  await expect(routeRow(page, "p / m · xhigh")).toHaveCount(1);
  expect(await matrixRating(page, "h")).toContain("80.0");
  await page.reload();
  await expect(routeRow(page, "p / m · xhigh")).toHaveCount(1);
  await page.locator("#matrix-view").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("reasoning-matrix.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test("reasoning filter leaves a direct row and fixed harness rating; evidence URLs restore the same mode", async ({ page }) => {
  await page.goto("/?reasoning=low");
  await expect(routeRow(page, "p / m · low")).toHaveCount(1);
  await expect(page.locator(".matrix-model-toggle")).toHaveCount(0);
  await expect(page.locator('.matrix-table thead .matrix-expand-toggle[data-harness="baseline-agent"]')).toHaveCount(0);
  await expect(page.locator('.matrix-table thead .matrix-expanded-head')).toHaveCount(0);
  await page.locator('[data-summary-tab="models"]').click();
  await expect(grid(page, "models").locator("tbody tr")).toHaveCount(1);
  await expect(rankedRow(page, "models", "m · low")).toContainText("55");
  expect(await matrixRating(page, "h")).toContain("80.0");
  await routeRow(page, "p / m · low").locator("th .matrix-header").click();
  await expect(page.locator("#cell-details[open]")).toBeVisible();
  await expect(page.locator("#cell-details-title")).toContainText("p / m · low");
  await expect(page.locator("#cell-details")).not.toContainText("high-new");
  await page.reload();
  await expect(page.locator("#cell-details-title")).toContainText("p / m · low");
  await page.mouse.click(2, 2);
  await expect(page.locator("#cell-details")).not.toBeVisible();
  await page.locator('[data-summary-tab="combinations"]').click();
  await rankedRow(page, "combinations", "m · low").getByRole("button", { name: "m · low", exact: true }).click();
  await expect(page.locator("#cell-details[open]")).toBeVisible();
  await page.reload();
  await expect(page.locator("#cell-details[open]")).toBeVisible();
  await expect(page.locator("#cell-details")).not.toContainText("high-new");
});

test("filtering from variant evidence keeps reasoning and comparison selections survive reload", async ({ page }) => {
  await page.goto("/");
  await rankedRow(page, "combinations", "m · low").getByRole("button", { name: "m · low", exact: true }).click();
  await page.getByRole("button", { name: "Filter table to this model and harness", exact: true }).click();
  await expect(grid(page, "combinations").locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("#active-filters")).toContainText("low");
  await expect(routeRow(page, "p / m · high")).toHaveCount(0);
  await routeRow(page, "p / m · low").locator(".matrix-cell").click();
  await expect(page.locator(".matrix-table td.selected")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".matrix-table td.selected")).toHaveCount(1);
  await expect(grid(page, "combinations").locator("tbody tr")).toHaveCount(1);
  expect(await matrixRating(page, "h")).toContain("80.0");
});
