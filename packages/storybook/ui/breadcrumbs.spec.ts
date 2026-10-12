import { expect, story } from "../support/story.js"

story("shows the focus ring on a keyboard-focused crumb", async ({ visit, page }) => {
  const link = (await visit("ui-breadcrumbs--nested")).getByRole("link", { name: "Projects" })
  await page.keyboard.press("Tab")
  await expect(link).toBeFocused()
  await expect(link).toHaveCSS("outline-style", "solid")
})
