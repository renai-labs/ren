import { expect, story } from "../../support/story.js"

story("approval follows the core continuation default unless the person changes it", async ({ visit, page }) => {
  await visit("app-tasks-task-review--approve")
  await expect(page.getByRole("combobox", { name: "After review" })).toContainText("Use default")
  await page.getByRole("button", { name: "Approve", exact: true }).click()
  await expect(page.getByText("Approved · Default continuation", { exact: true })).toBeVisible()
})

story("requesting changes needs a nonblank comment and can leave the agent idle", async ({ visit, page }) => {
  await visit("app-tasks-task-review--request-changes")
  await page.getByRole("button", { name: "Request changes", exact: true }).click()
  await expect(page.getByText("Comment is required.", { exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "What needs to change?" }).fill("Add the migration rollback steps.")
  await page.getByRole("combobox", { name: "After review" }).click()
  await page.getByRole("option", { name: "Keep agent idle" }).click()
  await page.getByRole("button", { name: "Request changes", exact: true }).click()
  await expect(
    page.getByText("Changes requested · none · Add the migration rollback steps.", { exact: true }),
  ).toBeVisible()
})
