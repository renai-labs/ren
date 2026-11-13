import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

const lines = (label: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${label} ${index + 1}`).join("\n")

async function send(page: import("@playwright/test").Page, input: { typed: string; pasted?: string }) {
  await page.goto("/app/")
  const box = page.getByRole("textbox", { name: "Message" })
  await box.fill(input.typed)
  if (input.pasted)
    await page.evaluate(`(() => {
      const transfer = new DataTransfer()
      transfer.setData("text/plain", ${JSON.stringify(input.pasted)})
      document
        .querySelector('main textarea[aria-label="Message"]')
        .dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }))
    })()`)
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
}

test("a member reads more of a long typed message and turns folding off in Preferences", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await send(page, { typed: lines("Row", 25), pasted: lines("Pasted", 25) })
  const bubble = page.locator("[data-slot=bubble-content]").filter({ hasText: "Row 12" })
  const height = async () => (await bubble.boundingBox())?.height ?? 0
  const more = page.getByRole("button", { name: "Read more" })
  await expect(more).toHaveAttribute("aria-expanded", "false")
  await expect(bubble).toContainText("Row 25")
  await expect(page.getByText("Pasted text")).toBeVisible()
  const folded = await height()
  await more.click()
  await expect(page.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true")
  await expect.poll(height).toBeGreaterThan(folded)

  await send(page, { typed: lines("Short", 15) })
  await expect(page.getByRole("button", { name: "Read more" })).toHaveCount(0)

  await page.goto("/app/settings/preferences")
  const fold = page.getByRole("switch", { name: "Fold long messages" })
  await expect(fold).toBeChecked()
  await fold.click()
  await expect(fold).not.toBeChecked()
  await page.reload()
  await expect(fold).not.toBeChecked()

  await send(page, { typed: lines("Line", 25), pasted: lines("Pasted", 25) })
  await expect(page.getByText("Pasted text")).toBeVisible()
  await expect(page.locator("[data-searchable]").filter({ hasText: "Line 25" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Read more" })).toHaveCount(0)
})

test("find opens a folded message when the match is below the fold", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await send(page, { typed: lines("Row", 25), pasted: lines("Pasted", 25) })
  await expect(page.getByRole("button", { name: "Read more" })).toHaveAttribute("aria-expanded", "false")
  await page.keyboard.press("ControlOrMeta+f")
  await page.getByRole("searchbox", { name: "Find in chat" }).fill("Row 20")
  await expect(page.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator("[data-searchable]").filter({ hasText: "Row 25" })).toBeVisible()
})
