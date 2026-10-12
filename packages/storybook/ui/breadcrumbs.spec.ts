import { expect, story } from "../support/story.js"

story("shows the focus ring on a keyboard-focused crumb", async ({ visit, page }) => {
  const link = (await visit("ui-breadcrumbs--nested")).getByRole("link", { name: "Projects" })
  await page.keyboard.press("Tab")
  await expect(link).toBeFocused()
  await expect(link).toHaveCSS("outline-style", "solid")
})

story("links earlier crumbs and marks the current page", async ({ visit }) => {
  const trail = (await visit("ui-breadcrumbs--nested")).getByRole("navigation", { name: "Breadcrumb" })
  await expect(trail.getByRole("listitem")).toHaveText(["Projects", "Ren", "Settings"])
  await expect(trail.getByRole("link")).toHaveText(["Projects", "Ren"])
  await expect(trail.locator('[aria-current="page"]')).toHaveText("Settings")
})
