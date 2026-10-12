import { expect, story } from "../support/story.js"

story("moves focus between controls with the arrow keys", async ({ visit, page }) => {
  const toolbar = (await visit("ui-toolbar--end")).getByRole("toolbar", { name: "Projects" })
  await page.keyboard.press("Tab")
  await expect(toolbar.getByRole("button", { name: "Refresh projects" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(toolbar.getByRole("button", { name: "Filter projects" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(toolbar.getByRole("button", { name: "New project" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(toolbar.getByRole("button", { name: "Refresh projects" })).toBeFocused()
  await page.keyboard.press("ArrowLeft")
  await expect(toolbar.getByRole("button", { name: "New project" })).toBeFocused()
})

story("keeps a single tab stop", async ({ visit, page }) => {
  const toolbar = (await visit("ui-toolbar--end")).getByRole("toolbar", { name: "Projects" })
  await page.keyboard.press("Tab")
  await expect(toolbar.getByRole("button", { name: "Refresh projects" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(toolbar.locator(":focus")).toHaveCount(0)
})

story("skips disabled controls", async ({ visit, page }) => {
  const toolbar = (await visit("ui-toolbar--disabled")).getByRole("toolbar", { name: "Projects" })
  await page.keyboard.press("Tab")
  await page.keyboard.press("ArrowRight")
  await expect(toolbar.getByRole("button", { name: "Export" })).toBeFocused()
})

story("includes links in the arrow key order", async ({ visit, page }) => {
  const toolbar = (await visit("ui-toolbar--with-link")).getByRole("toolbar", { name: "Projects" })
  await page.keyboard.press("Tab")
  await expect(toolbar.getByRole("link", { name: "View docs" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(toolbar.getByRole("button", { name: "Export" })).toBeFocused()
})

story("leaves leading tabs to their own arrow keys", async ({ visit, page }) => {
  const toolbar = (await visit("ui-toolbar--split")).getByRole("toolbar", { name: "Projects" })
  await page.keyboard.press("Tab")
  await expect(toolbar.getByRole("tab", { name: "Members" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(toolbar.getByRole("tab", { name: "Invitations" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(toolbar.getByRole("tab", { name: "Members" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(toolbar.getByRole("button", { name: "Refresh projects" })).toBeFocused()
})
