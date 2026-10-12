import { expect, story } from "../support/story.js"

story("picks a theme with the keyboard", async ({ visit, page }) => {
  const root = await visit("ui-theme-selector--interactive")
  const group = root.getByRole("radiogroup", { name: "Theme" })
  await expect(group.getByRole("radio", { name: "Light" })).toBeChecked()
  await group.getByRole("radio", { name: "Light" }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(group.getByRole("radio", { name: "Dark" })).toBeChecked()
})

story("reveals more themes and keeps them open while one is chosen", async ({ visit }) => {
  const root = await visit("ui-theme-selector--interactive")
  await expect(root.getByRole("radio", { name: "Girliepop" })).toBeHidden()
  await root.getByRole("button", { name: "Show more" }).click()
  await root.getByRole("radio", { name: "Girliepop" }).click()
  await expect(root.getByRole("radio", { name: "Girliepop" })).toBeChecked()
  await expect(root.getByRole("button", { name: "Show less" })).toBeHidden()
})

story("names each theme after its own label inside a field", async ({ visit }) => {
  const root = await visit("ui-theme-selector--in-field")
  await expect(root.getByRole("radio", { name: "Dark" })).toBeChecked()
  await root.getByRole("radio", { name: "Light" }).click()
  await expect(root.getByRole("radio", { name: "Light" })).toBeChecked()
})
