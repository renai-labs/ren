import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

test("mentions settings shows live connection states and removes the prototype navigation", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  await page.goto("/app/settings/channels")
  await expect(page.getByRole("heading", { level: 1, name: "@mentions", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Mentions lab" })).toBeHidden()
  await expect(page.getByText("Connected", { exact: true })).toBeHidden()
  await page.goto("/app/settings/channels/slack")
  await expect(page.getByRole("heading", { level: 1, name: "Slack", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Disconnect Slack", exact: true })).toBeHidden()
  await expect(page.getByRole("table")).toBeHidden()
  await page.getByRole("link", { name: "Back to @mentions" }).click()
  await expect(page).toHaveURL(/\/settings\/channels$/)
})

test("a sent @path to a workspace file shows a file chip and other text stays text", async ({ page }) => {
  test.setTimeout(120_000)
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill("Set up the project")
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: "Open panel", exact: true }).click()
  const panel = page.getByRole("complementary", { name: "Workspace" })
  await panel.getByRole("button", { name: /^Terminal:/ }).click()
  const command = panel.getByRole("textbox", { name: "Command" })
  await command.fill("mkdir -p src && printf 'export const answer = 42\\n' > src/answer.ts && echo created")
  await command.press("Enter")
  await expect(panel.getByText("created", { exact: true })).toBeVisible()

  await message.fill("Why does @src/answer.ts:42 re-render? Not src/other.ts or @src/missing.ts")
  await message.press("Enter")
  await expect(page.locator('[data-path="src/answer.ts"]')).toContainText("answer.ts:42")
  await expect(page.locator("[data-path]")).toHaveCount(1)
  await expect(page.getByText("@src/missing.ts")).toBeVisible()
})
