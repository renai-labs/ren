import { expect, story } from "../support/story.js"

story("moves the selection with the arrow keys", async ({ visit, page }) => {
  const group = (await visit("ui-radio-group--unselected")).getByRole("radiogroup", { name: "Network access" })
  const unrestricted = group.getByRole("radio", { name: /Unrestricted/ })
  const limited = group.getByRole("radio", { name: /Limited/ })
  await page.keyboard.press("Tab")
  await expect(unrestricted).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(limited).toBeFocused()
  await expect(limited).toBeChecked()
  await page.keyboard.press("ArrowUp")
  await expect(unrestricted).toBeFocused()
  await expect(unrestricted).toBeChecked()
  await expect(limited).not.toBeChecked()
})

story("rings the focused item only for keyboard focus", async ({ visit, page }) => {
  const root = await visit("ui-radio-group--unselected")
  const item = root.locator("label").first()
  await item.click()
  await expect(item).toHaveCSS("outline-style", "none")
  await page.keyboard.press("ArrowDown")
  await expect(root.locator("label").nth(1)).toHaveCSS("outline-style", "solid")
})

story("names and describes each radio by its own label and selects it from its card", async ({ visit }) => {
  const group = (await visit("ui-radio-group--unselected")).getByRole("radiogroup", { name: "Network access" })
  const limited = group.getByRole("radio", { name: "Limited", exact: true })
  await expect(limited).toHaveAccessibleDescription("Only approved destinations.")
  await group.getByText("Only approved destinations.").click()
  await expect(limited).toBeChecked()
})
