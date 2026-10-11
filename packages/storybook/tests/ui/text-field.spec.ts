import { expect, story } from "../story.js"

story("draws the focus ring on the surface while the input has focus", async ({ visit }) => {
  const root = await visit("ui-text-field--outline")
  const surface = root.locator('[data-slot="text-field"]')
  const before = await surface.evaluate((element) => getComputedStyle(element).boxShadow)
  await root.getByRole("textbox", { name: "Project name" }).focus()
  await expect.poll(() => surface.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(before)
})

story("filters suggestions while typing and picks one from the keyboard", async ({ visit, page }) => {
  const root = await visit("ui-text-field--suggestions")
  const input = root.getByRole("combobox", { name: "Permission" })
  await input.fill("ed")
  const options = page.getByRole("option")
  await expect(options).toHaveText(["edit"])
  await input.press("ArrowDown")
  await input.press("Enter")
  await expect(input).toHaveValue("edit")
  await expect(page.getByRole("listbox")).toBeHidden()
})

story("dismisses suggestions on Escape", async ({ visit, page }) => {
  const root = await visit("ui-text-field--suggestions")
  const input = root.getByRole("combobox", { name: "Permission" })
  await input.fill("e")
  await expect(page.getByRole("listbox")).toBeVisible()
  await input.press("Escape")
  await expect(page.getByRole("listbox")).toBeHidden()
})
