import { expect, story } from "../story.js"

story("expands into a focused field and collapses back to its button on Escape", async ({ visit }) => {
  const root = await visit("ui-search-field--expandable")
  await root.getByRole("button", { name: "Search" }).click()
  const input = root.getByRole("searchbox", { name: "Search" })
  await expect(input).toBeFocused()
  await input.fill("billing")
  await input.press("Escape")
  await expect(input).toBeHidden()
  await expect(root.getByRole("button", { name: "Search" })).toBeFocused()
})

story("collapses when an empty field loses focus", async ({ visit, page }) => {
  const root = await visit("ui-search-field--expandable")
  await root.getByRole("button", { name: "Search" }).click()
  await expect(root.getByRole("searchbox")).toBeFocused()
  await page.mouse.click(1, 1)
  await expect(root.getByRole("searchbox")).toBeHidden()
  await expect(root.getByRole("button", { name: "Search" })).toBeVisible()
})

story("stays open after losing focus while it holds a value", async ({ visit, page }) => {
  const root = await visit("ui-search-field--expandable")
  await root.getByRole("button", { name: "Search" }).click()
  await root.getByRole("searchbox").fill("billing")
  await page.mouse.click(1, 1)
  await expect(root.getByRole("searchbox")).toHaveValue("billing")
})

story("clears the value and keeps focus in the field", async ({ visit }) => {
  const root = await visit("ui-search-field--with-value")
  const input = root.getByRole("searchbox", { name: "Search" })
  await input.click()
  await root.getByRole("button", { name: "Clear search" }).click()
  await expect(input).toHaveValue("")
  await expect(input).toBeFocused()
  await expect(root.getByRole("button", { name: "Clear search" })).toBeHidden()
})
