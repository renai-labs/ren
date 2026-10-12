import { expect, story } from "../support/story.js"

story("closes on Escape", async ({ visit, page }) => {
  await visit("ui-dialog--default")
  const dialog = page.getByRole("dialog", { name: "Rename project" })
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
})

story("closes on an outside click", async ({ visit, page }) => {
  await visit("ui-dialog--default")
  const dialog = page.getByRole("dialog", { name: "Rename project" })
  await expect(dialog).toBeVisible()
  await page.mouse.click(8, 700)
  await expect(dialog).toBeHidden()
})

story("traps focus and returns it to the trigger", async ({ visit, page }) => {
  const trigger = (await visit("ui-dialog--closed")).getByRole("button", { name: "Rename project" })
  await trigger.click()
  const dialog = page.getByRole("dialog", { name: "Rename project" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused()
  for (const name of ["Rename project", "Close", "Cancel", "Rename project", "Close"]) {
    await page.keyboard.press("Tab")
    await expect(dialog.getByRole("button", { name, exact: true })).toBeFocused()
  }
  await page.keyboard.press("Shift+Tab")
  await expect(dialog.getByRole("button", { name: "Rename project" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

story("ignores Escape, outside clicks and close buttons while dismissal is blocked", async ({ visit, page }) => {
  await visit("ui-dialog--blocked")
  const dialog = page.getByRole("dialog", { name: "Rename project" })
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await page.mouse.click(8, 700)
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled()
})
