import { defineConfig } from "@playwright/test"

const port = Number(process.env.E2E_PORT ?? 4010)

export default defineConfig({
  testDir: "./tests",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: "bun run --cwd ../server start",
    url: `http://127.0.0.1:${port}/api/health`,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
  },
})
