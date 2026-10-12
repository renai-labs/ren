import { expect, story } from "../story.js"

story("collapses and expands the sidebar from its button and the keyboard", async ({ visit, page }) => {
  await visit("ui-application-shell--expanded")
  const sidebar = page.getByRole("complementary", { name: "Navigation" })
  await expect(sidebar).toHaveAttribute("data-state", "expanded")
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await expect(sidebar).toHaveAttribute("data-state", "collapsed")
  await expect(sidebar.getByText("Chats")).toBeHidden()
  await page.keyboard.press("ControlOrMeta+b")
  await expect(sidebar).toHaveAttribute("data-state", "expanded")
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible()
})

story("labels collapsed navigation items with a tooltip", async ({ visit, page }) => {
  await visit("ui-application-shell--collapsed")
  await page.getByRole("link", { name: "Tasks" }).hover()
  await expect(page.locator('[data-slot="tooltip"]')).toHaveText("Tasks")
})

story("opens the navigation drawer on mobile and returns focus when it closes", async ({ visit, page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await visit("ui-application-shell--mobile")
  await expect(page.getByRole("complementary", { name: "Navigation" })).toHaveCount(0)
  const trigger = page.getByRole("button", { name: "Open navigation" })
  await trigger.click()
  const drawer = page.getByRole("dialog", { name: "Navigation" })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole("link", { name: "Home" })).toBeVisible()
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press("Escape")
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
})

story("closes the drawer from its button, an outside click and an item", async ({ visit, page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await visit("ui-application-shell--mobile-open")
  const drawer = page.getByRole("dialog", { name: "Navigation" })
  await expect(drawer).toBeVisible()
  await drawer.getByRole("button", { name: "Close navigation" }).click()
  await expect(drawer).toBeHidden()

  const trigger = page.getByRole("button", { name: "Open navigation" })
  await trigger.click()
  await expect(drawer).toBeVisible()
  await page.mouse.click(370, 400)
  await expect(drawer).toBeHidden()

  await trigger.click()
  await drawer.getByRole("link", { name: "Tasks" }).click()
  await expect(drawer).toBeHidden()
})

story("toggles the drawer with the keyboard shortcut on mobile", async ({ visit, page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await visit("ui-application-shell--mobile")
  await page.keyboard.press("ControlOrMeta+b")
  const drawer = page.getByRole("dialog", { name: "Navigation" })
  await expect(drawer).toBeVisible()
  await page.keyboard.press("ControlOrMeta+b")
  await expect(drawer).toBeHidden()
})
