import { expect, story } from "../story.js"

story("shows the focus ring only for keyboard focus", async ({ visit, page }) => {
  const button = (await visit("ui-button--primary")).getByRole("button", { name: "Save draft" })
  await button.click()
  await expect(button).toHaveCSS("outline-style", "none")
  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Tab")
  await expect(button).toBeFocused()
  await expect(button).toHaveCSS("outline-style", "solid")
})
