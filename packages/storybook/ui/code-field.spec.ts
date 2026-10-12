import type { Locator } from "@playwright/test"
import { expect, story } from "../support/story.js"

const values = (slots: Locator) =>
  expect.poll(() =>
    slots.evaluateAll((inputs) => inputs.map((input) => (input instanceof HTMLInputElement ? input.value : ""))),
  )

story("advances to the next slot while typing", async ({ visit, page }) => {
  const slots = (await visit("ui-code-field--default")).getByRole("textbox")
  await slots.first().click()
  await page.keyboard.type("123")
  await values(slots).toEqual(["1", "2", "3", "", "", ""])
  await expect(slots.nth(3)).toBeFocused()
})

story("ignores characters that are not digits", async ({ visit, page }) => {
  const slots = (await visit("ui-code-field--default")).getByRole("textbox")
  await slots.first().click()
  await page.keyboard.type("1a")
  await values(slots).toEqual(["1", "", "", "", "", ""])
  await expect(slots.nth(1)).toBeFocused()
})

story("fills every slot from a pasted code", async ({ visit, page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const root = await visit("ui-code-field--default")
  const slots = root.getByRole("textbox")
  await page.evaluate(() => navigator.clipboard.writeText("482913"))
  await slots.first().click()
  await page.keyboard.press("ControlOrMeta+v")
  await values(slots).toEqual(["4", "8", "2", "9", "1", "3"])
  await expect(root.locator('[data-slot="code-field"]')).toHaveAttribute("data-complete", "")
})

story("moves back and clears the previous slot on backspace", async ({ visit, page }) => {
  const slots = (await visit("ui-code-field--default")).getByRole("textbox")
  await slots.first().click()
  await page.keyboard.type("123")
  await page.keyboard.press("Backspace")
  await values(slots).toEqual(["1", "2", "", "", "", ""])
  await expect(slots.nth(2)).toBeFocused()
  await page.keyboard.press("Backspace")
  await values(slots).toEqual(["1", "", "", "", "", ""])
  await expect(slots.nth(1)).toBeFocused()
})

story("completes once every slot is filled", async ({ visit, page }) => {
  const root = await visit("ui-code-field--four-digits")
  await root.getByRole("textbox").first().click()
  await page.keyboard.type("123")
  const field = root.locator('[data-slot="code-field"]')
  await expect(field).not.toHaveAttribute("data-complete")
  await page.keyboard.type("4")
  await expect(field).toHaveAttribute("data-complete", "")
})

story("describes every slot with the error message", async ({ visit }) => {
  const slots = (await visit("ui-code-field--invalid-with-message")).getByRole("textbox")
  await expect(slots.first()).toHaveAccessibleDescription("That code didn’t work. Check it and try again.")
  await expect(slots.last()).toHaveAccessibleDescription("That code didn’t work. Check it and try again.")
})
