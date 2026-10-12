import { expect, story } from "../support/story.js"

story("reveals the value without taking focus from the field", async ({ visit }) => {
  const root = await visit("ui-password-field--default")
  const input = root.getByLabel("Password", { exact: true })
  await input.click()
  await input.press("End")
  await root.getByRole("button", { name: "Show password" }).click()
  await expect(input).toHaveAttribute("type", "text")
  await expect(input).toHaveValue("correct horse battery staple")
  await expect(input).toBeFocused()
  await input.press("!")
  await expect(input).toHaveValue("correct horse battery staple!")
})

story("toggles from the keyboard and keeps focus on the toggle", async ({ visit, page }) => {
  const root = await visit("ui-password-field--default")
  await root.getByLabel("Password", { exact: true }).focus()
  await page.keyboard.press("Tab")
  const toggle = root.getByRole("button", { name: "Show password" })
  await expect(toggle).toBeFocused()
  await page.keyboard.press("Space")
  await expect(root.getByRole("button", { name: "Hide password" })).toBeFocused()
  await expect(root.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text")
})
