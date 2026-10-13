import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.STORYBOOK_PORT ?? 6116)

export default defineConfig({
  testDir: ".",
  testIgnore: /node_modules/,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  snapshotPathTemplate: "{testDir}/test-results/parity/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixels: 0, animations: "disabled", caret: "hide" } },
  use: { baseURL: `http://127.0.0.1:${port}`, ...devices["Desktop Chrome"] },
  projects: [
    { name: "ui", testMatch: /storybook\/(ui|app|sweep)\/.*\.spec\.ts$/ },
    { name: "parity", testMatch: /storybook\/parity\/.*\.spec\.ts$/, timeout: 180_000, use: { colorScheme: "dark" } },
  ],
  webServer: {
    command: process.env.CI ? `bun run script/serve.ts ${port}` : `bunx storybook dev -p ${port} --no-open --ci`,
    url: `http://127.0.0.1:${port}/iframe.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
