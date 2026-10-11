import { expect, story } from "../story.js"

story("toggles with Space once focused from the keyboard", async ({ visit, page }) => {
  const control = (await visit("ui-switch--unchecked")).getByRole("switch", { name: "Build after creation" })
  await page.keyboard.press("Tab")
  await expect(control).toBeFocused()
  await page.keyboard.press("Space")
  await expect(control).toBeChecked()
  await page.keyboard.press("Space")
  await expect(control).not.toBeChecked()
})
