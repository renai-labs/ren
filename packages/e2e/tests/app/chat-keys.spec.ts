import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

test("a member types and pastes into the composer from anywhere on the chat page and jumps to the latest message", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill("Plan the launch")
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  await page.getByText("stub reply").click()
  await expect(message).not.toBeFocused()
  await page.keyboard.type("hi")
  await expect(message).toHaveValue("hi")
  await expect(message).toBeFocused()

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await page.evaluate(`navigator.clipboard.writeText(" there")`)
  await page.getByText("stub reply").click()
  await expect(message).not.toBeFocused()
  await page.keyboard.press("ControlOrMeta+V")
  await expect(message).toHaveValue("hi there")

  for (const text of ["Second note", "Third note", "Fourth note", "Fifth note"]) {
    await message.fill(text)
    await message.press("Enter")
    await expect(page.getByText(text, { exact: true })).toBeVisible()
  }
  const viewport = page.locator("[data-slot=message-scroller-viewport]")
  await viewport.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.getByText("stub reply").first().click()
  await page.keyboard.press("Control+End")
  await expect(page.getByText("Fifth note", { exact: true })).toBeInViewport()
})
