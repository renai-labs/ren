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

story("names the box by its visible label, describes it, and toggles from the label", async ({ visit }) => {
  const root = await visit("ui-checkbox--description")
  const checkbox = root.getByRole("checkbox", { name: "Use PKCE", exact: true })
  await expect(checkbox).toHaveAccessibleDescription("Require a code challenge on every authorization request.")
  await root.getByText("Use PKCE").click()
  await expect(checkbox).toBeChecked()
})
