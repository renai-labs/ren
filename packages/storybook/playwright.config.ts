import { defineConfig, devices } from "@playwright/test"
import { Schema } from "effect"
import { Port } from "@ren/util/port"
import { testPort } from "./support/stories.js"

const port = Schema.decodeUnknownSync(Port.FromString)(process.env.STORYBOOK_PORT ?? String(testPort))

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
    command: process.env.REN_V1_PATH
      ? `bunx storybook dev -p ${port} --no-open --ci`
      : `bun run script/serve.ts ${port}`,
    url: `http://127.0.0.1:${port}/iframe.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
