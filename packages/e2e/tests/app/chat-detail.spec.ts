import { expect, test } from "@playwright/test"
import { createOrganization, scriptModel } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

test("a member hides steps with Messages only and keeps them in the timeline with fold off", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const marker = await scriptModel(page.request, {
    reply: "All done",
    tool: { name: "glob", input: { pattern: "*" } },
  })
  await page.goto("/app/")
  await page.getByRole("textbox", { name: "Message" }).fill(`Look around ${marker}`)
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
  const chat = page.url()
  await expect(page.getByText("All done")).toBeVisible({ timeout: brainStart })
  const fold = page.getByRole("button", { name: /^Worked/ })
  await expect(fold).toBeVisible()

  await page.goto("/app/settings/preferences")
  await page.getByRole("slider", { name: "Detail" }).focus()
  await page.keyboard.press("Home")
  await expect(page.getByText("Hide all activity.")).toBeVisible()
  await page.goto(chat)
  await expect(page.getByText("All done")).toBeVisible({ timeout: brainStart })
  await expect(page.getByRole("button", { name: /^Worked/ })).toHaveCount(0)

  await page.goto("/app/settings/preferences")
  await page.getByRole("slider", { name: "Detail" }).focus()
  await page.keyboard.press("End")
  await page.getByRole("switch", { name: "Fold finished turns" }).click()
  await page.goto(chat)
  await expect(page.getByText("All done")).toBeVisible({ timeout: brainStart })
  await expect(page.getByRole("button", { name: /^Worked/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Found/ }).first()).toBeVisible()
})
