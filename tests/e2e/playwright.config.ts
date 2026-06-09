import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PAPERCLIP_E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_CHANNEL = process.env.PAPERCLIP_E2E_BROWSER_CHANNEL?.trim() || undefined;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", channel: BROWSER_CHANNEL },
    },
  ],
  // The webServer directive starts `paperclipai run` before tests.
  // Expects `pnpm paperclipai` to be runnable from repo root.
  webServer: {
    command: `pnpm paperclipai run`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
});
