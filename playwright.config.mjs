import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  outputDir: ".tmp/e2e-results",
  reporter: "list",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8781", browserName: "chromium", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-dark", use: { viewport: { width: 1440, height: 1000 }, colorScheme: "dark" } },
    { name: "mobile-light", use: { viewport: { width: 390, height: 844 }, colorScheme: "light" } },
  ],
  webServer: { command: "python3 scripts/serve-preview.py 8781", url: "http://127.0.0.1:8781", reuseExistingServer: !process.env.CI },
});
