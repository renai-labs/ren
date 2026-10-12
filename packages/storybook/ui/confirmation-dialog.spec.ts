import { expect, story } from "../support/story.js"

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

story("describes the alert dialog with its description", async ({ visit, page }) => {
  await visit("ui-confirmation-dialog--default")
  await expect(page.getByRole("alertdialog", { name: "Delete ‘Q3 report’?" })).toHaveAccessibleDescription(
    "The report and its comments are removed for everyone.",
  )
})

story("closes once the confirmation succeeds", async ({ visit, page }) => {
  const trigger = (await visit("ui-confirmation-dialog--from-trigger")).getByRole("button", { name: "Delete report" })
  await trigger.click()
  const dialog = page.getByRole("alertdialog", { name: "Delete ‘Q3 report’?" })
  await dialog.getByRole("button", { name: "Delete" }).click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

story("falls back to a generic message when the failure has none", async ({ visit, page }) => {
  await visit("ui-confirmation-dialog--failing-without-reason")
  const dialog = page.getByRole("alertdialog", { name: "Delete ‘Q3 report’?" })
  await dialog.getByRole("button", { name: "Delete" }).click()
  await expect(dialog.getByText("The action didn’t finish. Try again.")).toBeVisible()
})
