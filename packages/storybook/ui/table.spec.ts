import { expect, story } from "../support/story.js"

story("sorts a column from the keyboard", async ({ visit, page }) => {
  const root = await visit("ui-table--sortable")
  const header = root.getByRole("columnheader", { name: "Name" })
  const firstName = root.getByRole("cell").first()
  await expect(header).toHaveAttribute("aria-sort", "ascending")
  await expect(firstName).toHaveText("Ada Lovelace")
  await page.keyboard.press("Tab")
  await expect(header.getByRole("button", { name: "Name" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(header).toHaveAttribute("aria-sort", "descending")
  await expect(firstName).toHaveText("Grace Hopper")
  await page.keyboard.press("Space")
  await expect(header).toHaveAttribute("aria-sort", "ascending")
  await expect(firstName).toHaveText("Ada Lovelace")
})
