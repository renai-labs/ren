import { expect, story } from "../support/story.js"

story.use({ timezoneId: "UTC", locale: "en-US" })

story.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-01T12:00:00Z"))
})

story("names the trigger by its visible date and says when it is overdue", async ({ visit, page }) => {
  await visit("ui-task-due-date--row")
  await expect(page.getByRole("button", { name: "Mar 14, Due date for Plan the migration", exact: true })).toBeVisible()
  await visit("ui-task-due-date--overdue")
  await expect(
    page.getByRole("button", { name: "Mar 14, overdue, Due date for Plan the migration", exact: true }),
  ).toBeVisible()
  await visit("ui-task-due-date--closed")
  await expect(page.getByRole("button", { name: "Mar 14, Due date for Plan the migration", exact: true })).toBeVisible()
  await visit("ui-task-due-date--empty")
  await expect(
    page.getByRole("button", { name: "Set due date, Due date for Plan the migration", exact: true }),
  ).toBeVisible()
})

story("picking a day saves it and closes the picker", async ({ visit, page }) => {
  await visit("ui-task-due-date--empty")
  await page.getByRole("button", { name: /^Set due date/ }).click()
  await page.getByRole("button", { name: "Today", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Due date" })).toBeHidden()
  await expect(page.getByRole("button", { name: "Jun 1, Due date for Plan the migration", exact: true })).toBeVisible()
})

story("a failed save keeps the due date picker open for retry", async ({ visit, page }) => {
  await visit("ui-task-due-date--failed")
  await page.getByRole("button", { name: /Due date for Plan the migration$/ }).click()
  await page.getByRole("button", { name: "Clear date" }).click()
  await expect(page.getByText("Couldn’t save the due date.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Clear date" })).toBeVisible()
})
