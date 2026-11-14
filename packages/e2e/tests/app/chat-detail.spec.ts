import { expect, test } from "@playwright/test"
import { createOrganization, script } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

test("a member hides steps with Messages only and keeps them in the timeline with fold off", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const marker = await script(page.request, {
    reply: "All done",
    tools: [{ name: "glob", input: { pattern: "*" } }],
  })
  await page.goto("/")
  await page.getByRole("textbox", { name: "Message" }).fill(`Look around ${marker}`)
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
  const chat = page.url()
  await expect(page.getByText("All done")).toBeVisible({ timeout: brainStart })
  const fold = page.getByRole("button", { name: /^Worked/ })
  await expect(fold).toBeVisible()

  await page.goto("/settings/preferences")
  await page.getByRole("slider", { name: "Timeline detail" }).focus()
  await page.keyboard.press("Home")
  await expect(page.getByText("Hide all activity.")).toBeVisible()
  await page.goto(chat)
  await expect(page.getByText("All done")).toBeVisible({ timeout: brainStart })
  await expect(page.getByRole("button", { name: /^Worked/ })).toHaveCount(0)

  await page.goto("/settings/preferences")
  await page.getByRole("slider", { name: "Timeline detail" }).focus()
  await page.keyboard.press("End")
  await page.getByRole("switch", { name: "Fold finished turns" }).click()
  await page.goto(chat)
  await expect(page.getByText("All done")).toBeVisible({ timeout: brainStart })
  await expect(page.getByRole("button", { name: /^Worked/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Found/ }).first()).toBeVisible()
})

test("expansion preferences update open chats without discarding unrelated manual toggles", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const marker = await script(page.request, {
    tools: [{ name: "shell", input: { command: "echo expansion-preference" } }],
  })
  await page.goto("/")
  await page.getByRole("textbox", { name: "Message" }).fill(`Run the command ${marker}`)
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
  await page.getByRole("button", { name: /^Worked/ }).click()
  const shell = page.getByRole("button", { name: /^Ran\b/ })
  await expect(shell).toHaveAttribute("aria-expanded", "false")

  const preferences = await page.context().newPage()
  await preferences.goto("/settings/preferences")
  await preferences.getByRole("button", { name: "Advanced", exact: true }).click()
  const collapse = preferences.getByRole("switch", { name: "Collapse Shell", exact: true })
  await collapse.click()
  await expect(shell).toHaveAttribute("aria-expanded", "true")
  await shell.click()
  await expect(shell).toHaveAttribute("aria-expanded", "false")
  await preferences.getByRole("switch", { name: "Collapse Thinking", exact: true }).click()
  await expect(shell).toHaveAttribute("aria-expanded", "false")
  await collapse.click()
  await expect(collapse).toBeChecked()
  await collapse.click()
  await expect(shell).toHaveAttribute("aria-expanded", "true")
})
