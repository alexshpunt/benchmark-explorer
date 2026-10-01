import { test, expect } from "@playwright/test";
import { snapshotFixture } from "./snapshot-fixture.mjs";

const cases = Array.from({ length: 20 }, (_, model) =>
  Array.from({ length: 12 }, (_, harness) => [
    `run-${model}-${harness}`, harness ? `harness-${harness}` : "baseline-agent",
    "1", "low", 8, 10, `model-${String(model).padStart(2, "0")}`,
  ])).flat();
const { bytes, manifest } = snapshotFixture(cases);

test("horizontal scroll stays available in the middle of the matrix and follows its bottom", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: page.viewportSize().width, height: 480 });
  await page.route("**/snapshot-manifest.json", (route) => route.fulfill({ json: manifest }));
  await page.route("**/snapshots/*.json.gz", (route) => route.fulfill({ body: bytes, contentType: "application/gzip" }));
  await page.goto("/");
  const matrix = page.locator("#matrix-view");
  const bar = page.locator("#matrix-scrollbar");
  const slider = page.getByRole("slider", { name: "Scroll matrix horizontally" });
  await expect(matrix.locator("tbody tr")).toHaveCount(21);
  await expect(bar).toBeHidden();
  await matrix.evaluate((root) => {
    const rect = root.getBoundingClientRect();
    window.scrollTo(0, scrollY + rect.top + (rect.height - innerHeight) / 2);
  });
  await expect(bar).toBeVisible();
  await expect.poll(async () => Math.round((await bar.boundingBox()).y + (await bar.boundingBox()).height)).toBe(472);
  const box = await slider.boundingBox();
  const thumbWidth = await bar.evaluate((element) => parseFloat(element.style.getPropertyValue("--scroll-thumb-width")));
  await page.mouse.move(box.x + thumbWidth / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + thumbWidth / 2 + 70, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => matrix.evaluate((root) => root.scrollLeft)).toBeGreaterThan(0);
  await slider.press("End");
  await expect.poll(() => matrix.evaluate((root) => Math.round(root.scrollWidth - root.clientWidth - root.scrollLeft))).toBe(0);
  await slider.press("Home");
  await expect.poll(() => matrix.evaluate((root) => root.scrollLeft)).toBe(0);
  await slider.press("ArrowRight");
  await expect.poll(() => matrix.evaluate((root) => root.scrollLeft)).toBe(40);
  await matrix.evaluate((root) => { root.scrollLeft = 120; });
  await expect.poll(() => slider.inputValue()).toBe("120");
  await page.screenshot({ path: testInfo.outputPath("matrix-scrollbar-middle.png") });
  await page.setViewportSize({ width: page.viewportSize().width - 40, height: 480 });
  await expect(bar).toBeVisible();
  await expect.poll(async () => (await bar.boundingBox()).width).toBe(await matrix.evaluate((root) => root.clientWidth));
  await expect.poll(() => slider.getAttribute("max")).toBe(String(await matrix.evaluate((root) => root.scrollWidth - root.clientWidth)));

  await matrix.evaluate((root) => window.scrollTo(0, scrollY + root.getBoundingClientRect().bottom - innerHeight / 2));
  await expect.poll(async () => Math.round((await bar.boundingBox()).y + (await bar.boundingBox()).height)).toBe(239);
  await page.locator(".pareto-panel").scrollIntoViewIfNeeded();
  await expect(bar).toBeHidden();
  await matrix.evaluate((root) => window.scrollTo(0, scrollY + root.getBoundingClientRect().top - 100));
  await slider.press("Home");
  await expect.poll(() => matrix.evaluate((root) => root.scrollLeft)).toBe(0);
  await page.locator('.matrix-table thead [aria-label="Filter to baseline-agent"]').click();
  await expect(matrix.locator("thead th")).toHaveCount(2);
  await expect(bar).toBeHidden();
  await expect(bar).toHaveCount(1);
  expect(errors).toEqual([]);
});
