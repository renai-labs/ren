import { expect, story } from "../support/story.js"

story("opens with a click and closes after choosing an item", async ({ visit, page }) => {
  const trigger = (await visit("ui-menu--closed")).getByRole("button", { name: "Options" })
  await trigger.click()
  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("menuitem", { name: "Duplicate" }).click()
  await expect(menu).toBeHidden()
})

story("opens from the keyboard, moves with arrows and jumps by typing", async ({ visit, page }) => {
  const trigger = (await visit("ui-menu--closed")).getByRole("button", { name: "Options" })
  await page.keyboard.press("Tab")
  await expect(trigger).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("menu")).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeFocused()
  await page.keyboard.press("a")
  await expect(page.getByRole("menuitem", { name: "Archive" })).toBeFocused()
})

story("closes on Escape and returns focus to the trigger", async ({ visit, page }) => {
  const trigger = (await visit("ui-menu--closed")).getByRole("button", { name: "Options" })
  await trigger.focus()
  await page.keyboard.press("Enter")
  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
})

story("opens a submenu with ArrowRight and closes it with ArrowLeft", async ({ visit, page }) => {
  await visit("ui-menu--submenu")
  await page.getByRole("menuitem", { name: "Rename" }).hover()
  await page.keyboard.press("ArrowDown")
  const moveTo = page.getByRole("menuitem", { name: "Move to" })
  await expect(moveTo).toBeFocused()
  await page.keyboard.press("ArrowRight")
  const inbox = page.getByRole("menuitem", { name: "Inbox", exact: true })
  await expect(inbox).toBeFocused()
  await expect(moveTo).toHaveAttribute("data-popup-open")
  await page.keyboard.press("ArrowLeft")
  await expect(inbox).toBeHidden()
  await expect(moveTo).toBeFocused()
})

story("toggles a checkbox item without closing the menu", async ({ visit, page }) => {
  await visit("ui-menu--checkboxes")
  const tuesday = page.getByRole("menuitemcheckbox", { name: "Tue" })
  await expect(tuesday).toHaveAttribute("aria-checked", "false")
  await tuesday.click()
  await expect(tuesday).toHaveAttribute("aria-checked", "true")
  await expect(page.getByRole("menu")).toBeVisible()
})

story("announces the selected item", async ({ visit, page }) => {
  await visit("ui-menu--selected")
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toBeChecked()
  await expect(page.getByRole("menuitemradio", { name: "Light" })).not.toBeChecked()
})

story("keeps the menu open when a disabled item is clicked", async ({ visit, page }) => {
  await visit("ui-menu--disabled")
  const archive = page.getByRole("menuitem", { name: "Archive" })
  await expect(archive).toBeDisabled()
  await archive.click({ force: true })
  await expect(page.getByRole("menu")).toBeVisible()
})

story("checks one radio item at a time", async ({ visit, page }) => {
  await visit("ui-menu--radios")
  const updated = page.getByRole("menuitemradio", { name: "Last updated" })
  const created = page.getByRole("menuitemradio", { name: "Created" })
  await expect(updated).toBeChecked()
  await created.click()
  await expect(created).toBeChecked()
  await expect(updated).not.toBeChecked()
})

story("names each section by its label", async ({ visit, page }) => {
  await visit("ui-menu--sections")
  await expect(page.getByRole("group", { name: "Session" }).getByRole("menuitem")).toHaveText(["Rename", "Copy link"])
  await expect(page.getByRole("group", { name: "Danger zone" }).getByRole("menuitem")).toHaveText(["Delete"])
})
