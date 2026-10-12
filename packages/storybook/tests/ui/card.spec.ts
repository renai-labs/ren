import { expect, story } from "../story.js"

story("reveals the link arrow on hover and keyboard focus", async ({ visit, page }) => {
  const card = (await visit("ui-card--link")).getByRole("link", { name: "Open release notes" })
  const arrow = card.locator("[data-slot=icon]").last().locator("..")
  await expect(arrow).toHaveCSS("opacity", "0")
  await card.hover()
  await expect(arrow).toHaveCSS("opacity", "1")
  await page.mouse.move(0, 0)
  await page.keyboard.press("Tab")
  await expect(card).toBeFocused()
  await expect(card).toHaveCSS("outline-style", "solid")
  await expect(arrow).toHaveCSS("opacity", "1")
})

story("activates a divided card section from the keyboard", async ({ visit, page }) => {
  const root = await visit("ui-card--divided-selected")
  await page.keyboard.press("Tab")
  await expect(root.getByRole("button", { name: "Stop the session" })).toBeFocused()
  await page.keyboard.press("Tab")
  const section = root.getByRole("button", { name: "Open the session" })
  await expect(section).toBeFocused()
  await expect(section).toHaveAttribute("aria-pressed", "true")
})
