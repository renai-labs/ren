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
