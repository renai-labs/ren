import { defineConfig } from "@playwright/test"
import { ports } from "./tests/lib/env.js"

export default defineConfig({
  testDir: "./tests",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${ports.app}`,
  },
  webServer: {
    command: "bun script/serve.ts",
    url: `http://127.0.0.1:${ports.app}/app/`,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    reuseExistingServer: !process.env.CI,
  },
})
