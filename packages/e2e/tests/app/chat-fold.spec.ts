import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 90_000 })

const lines = (count: number) => Array.from({ length: count }, (_, index) => `Line ${index + 1}`).join("\n")

async function send(page: import("@playwright/test").Page, text: string) {
  await page.goto("/app/")
  await page.getByRole("textbox", { name: "Message" }).fill(text)
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
}

test("a member folds long messages from Preferences, reads more, and pasted blocks stay chips", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/settings/preferences")
  const fold = page.getByRole("switch", { name: "Fold long messages" })
  await expect(fold).not.toBeChecked()
  await expect(page.getByText("Show the first 8 lines of a message over 12 lines.")).toBeVisible()

  await send(page, lines(15))
  await expect(page.getByText("Line 15", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Read more" })).toHaveCount(0)

  await page.goto("/app/settings/preferences")
  await fold.click()
  await expect(fold).toBeChecked()
  await page.reload()
  await expect(fold).toBeChecked()

  await send(page, lines(15))
  const more = page.getByRole("button", { name: "Read more" })
  await expect(more).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByText("Line 8", { exact: false })).toBeVisible()
  await expect(page.getByText("Line 9", { exact: false })).toHaveCount(0)
  await more.click()
  await expect(page.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByText("Line 15", { exact: false })).toBeVisible()

  await send(page, lines(25))
  await expect(page.getByText("Pasted text")).toBeVisible()
  await expect(page.getByRole("button", { name: "Read more" })).toHaveCount(0)
})
