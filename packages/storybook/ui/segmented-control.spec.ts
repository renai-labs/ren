import { expect, story } from "../support/story.js"

story("moves focus between segments with the arrow keys", async ({ visit, page }) => {
  const group = (await visit("ui-segmented-control--medium")).getByRole("group", { name: "View" })
  await page.keyboard.press("Tab")
  await expect(group.getByRole("button", { name: "Board" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(group.getByRole("button", { name: "List" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(group.getByRole("button", { name: "Calendar" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(group.getByRole("button", { name: "Board" })).toBeFocused()
  await page.keyboard.press("ArrowLeft")
  await expect(group.getByRole("button", { name: "Calendar" })).toBeFocused()
})

story("keeps a single tab stop", async ({ visit, page }) => {
  const group = (await visit("ui-segmented-control--medium")).getByRole("group", { name: "View" })
  await page.keyboard.press("Tab")
  await expect(group.getByRole("button", { name: "Board" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(group.locator(":focus")).toHaveCount(0)
})

story("shows a segment's description on hover", async ({ visit, page }) => {
  await (await visit("ui-segmented-control--described")).getByRole("button", { name: "Limited" }).hover()
  await expect(page.getByText("Only approved destinations.")).toBeVisible()
})
