import { test, expect } from "@playwright/test";
import { snapshotFixture } from "./snapshot-fixture.mjs";

const { bytes, manifest } = snapshotFixture([
  ["run-high", "baseline-agent", "1", "high", 8],
  ["run-off", "baseline-agent", "1", "off", 6],
  ["run-missing", "baseline-agent", "1", undefined, 4],
]);

test("all additions shows recorded reasoning next to each model and still opens the run", async ({ page }, testInfo) => {
  await page.route("**/snapshot-manifest.json", (route) => route.fulfill({ json: manifest }));
  await page.route("**/snapshots/*.json.gz", (route) => route.fulfill({ body: bytes, contentType: "application/gzip" }));
  await page.goto("/");
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
});
