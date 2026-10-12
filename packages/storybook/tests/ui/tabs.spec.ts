import { expect, story } from "../story.js"

story("moves focus with the arrow keys and activates on Enter", async ({ visit, page }) => {
  const list = (await visit("ui-tabs--default")).getByRole("tablist", { name: "Usage views" })
  await page.keyboard.press("Tab")
  await expect(list.getByRole("tab", { name: "Overview" })).toBeFocused()
  await page.keyboard.press("ArrowRight")
  const sessions = list.getByRole("tab", { name: "Per session" })
  await expect(sessions).toBeFocused()
  await expect(sessions).toHaveAttribute("aria-selected", "false")
  await page.keyboard.press("Enter")
  await expect(sessions).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await expect(list.getByRole("tab", { name: "Models" })).toBeFocused()
  await page.keyboard.press("Space")
  await expect(list.getByRole("tab", { name: "Models" })).toHaveAttribute("aria-selected", "true")
})

story("keeps a single tab stop on the selected tab", async ({ visit, page }) => {
  const list = (await visit("ui-tabs--counts")).getByRole("tablist", { name: "Members" })
  await page.keyboard.press("Tab")
  const members = list.getByRole("tab", { name: "Members" })
  await expect(members).toBeFocused()
  await expect(members).toHaveCSS("outline-style", "solid")
  await page.keyboard.press("Tab")
  await expect(list.locator(":focus")).toHaveCount(0)
})

story("shows the panel of the activated tab", async ({ visit }) => {
  const root = await visit("ui-tabs--panels")
  await expect(root.getByRole("tabpanel")).toHaveText("Spend across every session this month.")
  await root.getByRole("tab", { name: "Per session" }).click()
  await expect(root.getByRole("tabpanel", { name: "Per session" })).toHaveText("Spend broken down by session.")
})

story("moves between navigation links with Tab", async ({ visit, page }) => {
  const nav = (await visit("ui-tabs--navigation")).getByRole("navigation", { name: "Project pages" })
  await page.keyboard.press("Tab")
  await expect(nav.getByRole("link", { name: "Overview" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(nav.getByRole("link", { name: "Tasks" })).toBeFocused()
})
