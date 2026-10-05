import { test, expect } from "@playwright/test";
import { snapshotFixture } from "./snapshot-fixture.mjs";

// Check the same exact model label on every surface, including absent reasoning.
const { bytes, manifest } = snapshotFixture([
  ["run-high", "baseline-agent", "1", "high", 8],
  ["run-off", "baseline-agent", "1", "off", 6],
  ["run-missing", "baseline-agent", "1", undefined, 4],
  ["run-long", "pi-hashline-edit-pro", "1", "xhigh", 10, 10, "muse-spark-1.3-contributor"],
]);

test("all additions shows recorded reasoning next to each model and still opens the run", async ({ page }, testInfo) => {
  await page.route("**/snapshot-manifest.json", (route) => route.fulfill({ json: manifest }));
  await page.route("**/snapshots/*.json.gz", (route) => route.fulfill({ body: bytes, contentType: "application/gzip" }));
  await page.goto("/");
  for (const reasoning of ["high", "off", "unspecified"]) {
    await expect(page.locator("#recent-runs .recent-identity strong", { hasText: `p / m · ${reasoning}` })).toHaveText(`p / m · ${reasoning} · baseline-agent`);
  }
  const longName = page.locator("#recent-runs .recent-identity strong", { hasText: "muse-spark-1.3-contributor" });
  await expect(longName).toHaveText("p / muse-spark-1.3-contributor · xhigh · pi-hashline-edit-pro");
  expect(await longName.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.locator(".editorial-data").screenshot({ path: testInfo.outputPath("latest-additions.png") });
  await page.locator("#view-all-additions").click();
  const dialog = page.locator("#additions-dialog");
  await expect(dialog).toBeVisible();
  for (const [run, reasoning] of [["run-high", "high"], ["run-off", "off"], ["run-missing", "unspecified"]]) {
    const row = dialog.locator("tbody tr").filter({ has: page.getByRole("button", { name: run, exact: true }) });
    await expect(row.locator('[data-column-id="model"]')).toHaveText(`p / m · ${reasoning}`);
  }
  await page.screenshot({ path: testInfo.outputPath("additions.png") });
  await dialog.getByRole("button", { name: "p / m · high", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#cell-details[open]")).toContainText("run-high");
  await expect(page.locator("#cell-details[open]")).toContainText("p / m · high · baseline-agent");
});

test("matrix, results and model details share the exact route label; ratings omit provider", async ({ page }) => {
  await page.route("**/snapshot-manifest.json", (route) => route.fulfill({ json: manifest }));
  await page.route("**/snapshots/*.json.gz", (route) => route.fulfill({ body: bytes, contentType: "application/gzip" }));
  await page.goto("/?reasoning=high");
  const label = "p / m · high";
  await expect(page.locator(".matrix-header-label", { hasText: label })).toHaveText(label);
  await expect(page.locator('#results-grid tbody [data-column-id="model"]')).toHaveText(label);
  await expect(page.locator("#pareto-list strong")).toHaveText(label);
  await page.getByRole("button", { name: `${label}. baseline-agent@` }).click();
  await expect(page.locator("#task-families .selection-model")).toHaveText(label);
  await page.locator(".matrix-table tbody .matrix-header").click();
  await expect(page.locator("#cell-details-title")).toHaveText(`Model route: ${label}`);
  await expect(page.locator("#cell-details")).toContainText(`${label} · baseline-agent`);
  await page.getByRole("button", { name: "Close details", exact: true }).click();
  await page.locator('[data-summary-tab="models"]').click();
  await expect(page.locator('[data-summary-grid="models"] tbody [data-column-id="model"]')).toHaveText("m · high");
});
