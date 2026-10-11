import { expect, story } from "../story.js"

story("keeps the alert dialog open on an outside click", async ({ visit, page }) => {
  await visit("ui-confirmation-dialog--default")
  const dialog = page.getByRole("alertdialog", { name: "Delete ‘Q3 report’?" })
  await expect(dialog).toBeVisible()
  await page.mouse.click(8, 700)
  await expect(dialog).toBeVisible()
})

story("blocks dismissal while the confirmation is pending", async ({ visit, page }) => {
  await visit("ui-confirmation-dialog--pending")
  const dialog = page.getByRole("alertdialog", { name: "Delete ‘Q3 report’?" })
  const confirm = dialog.getByRole("button", { name: "Delete" })
  await confirm.click()
  await expect(confirm).toHaveAttribute("aria-busy", "true")
  await expect(confirm).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
})

story("shows why the confirmation failed", async ({ visit, page }) => {
  await visit("ui-confirmation-dialog--failing")
  const dialog = page.getByRole("alertdialog", { name: "Delete ‘Q3 report’?" })
  await dialog.getByRole("button", { name: "Delete" }).click()
  await expect(dialog.getByText("Unable to delete the report. Try again.")).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeEnabled()
})
