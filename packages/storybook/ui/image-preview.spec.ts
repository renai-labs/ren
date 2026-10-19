import { expect, story } from "../support/story.js"

story("opens an image in a dialog and closes it", async ({ visit, page }) => {
  const root = await visit("ui-image-preview--default")
  await root.getByRole("button", { name: "Open Revenue by quarter" }).click()
  const dialog = page.getByRole("dialog", { name: "Revenue by quarter" })
  await expect(dialog.getByRole("img", { name: "Revenue by quarter" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
})
