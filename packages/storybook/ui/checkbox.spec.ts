import { expect, story } from "../support/story.js"

story("toggles with Space once focused from the keyboard", async ({ visit, page }) => {
  const checkbox = (await visit("ui-checkbox--unchecked")).getByRole("checkbox", { name: "Use PKCE" })
  await page.keyboard.press("Tab")
  await expect(checkbox).toBeFocused()
  await page.keyboard.press("Space")
  await expect(checkbox).toBeChecked()
  await page.keyboard.press("Space")
  await expect(checkbox).not.toBeChecked()
})

story("skips a disabled checkbox when tabbing", async ({ visit, page }) => {
  const checkbox = (await visit("ui-checkbox--disabled")).getByRole("checkbox", { name: "Use PKCE" })
  await page.keyboard.press("Tab")
  await expect(checkbox).not.toBeFocused()
})
