import { expect, story } from "../support/story.js"

story("focuses the field, counts matches and steps with the keyboard", async ({ visit, page }) => {
  const root = await visit("ui-find-bar--default")
  const field = root.getByRole("searchbox", { name: "Find in chat" })
  await expect(field).toBeFocused()
  await expect(root.getByRole("status")).toBeHidden()
  await page.keyboard.type("revenue")
  await expect(root.getByRole("status")).toHaveText("1/3")
  await page.keyboard.press("Enter")
  await expect(root.getByRole("status")).toHaveText("2/3")
  await page.keyboard.press("Shift+Enter")
  await page.keyboard.press("ArrowUp")
  await expect(root.getByRole("status")).toHaveText("3/3")
  await root.getByRole("button", { name: "Next match" }).click()
  await expect(root.getByRole("status")).toHaveText("1/3")
})

story("closes with Escape", async ({ visit, page }) => {
  const root = await visit("ui-find-bar--default")
  await page.keyboard.press("Escape")
  await expect(root.getByText("Find in chat was closed.")).toBeVisible()
})
