import { expect, story } from "../../support/story.js"

story("the inline Markdown description saves without a submit button", async ({ visit, page }) => {
  await visit("app-tasks-task-text-editor--description")
  await page.getByRole("textbox", { name: "Task description" }).fill("Updated description")
  await expect(page.getByText("Saved: Updated description", { exact: true })).toBeVisible()
})

story("reverting a description while a save is in flight persists the latest draft", async ({ visit, page }) => {
  await visit("app-tasks-task-text-editor--queued-description")
  const editor = page.getByRole("textbox", { name: "Task description" })
  await editor.fill("First change")
  await expect(page.getByRole("button", { name: "Complete first save" })).toBeVisible()
  await editor.fill("Original description")
  await page.getByRole("button", { name: "Complete first save" }).click()
  await expect(page.getByText("First change → Original description", { exact: true })).toBeVisible()
  await expect(editor).toHaveText("Original description")
})

story("title editing validates before saving and preserves a valid draft", async ({ visit, page }) => {
  await visit("app-tasks-task-text-editor--title")
  await page.getByRole("textbox", { name: "Title" }).fill("   ")
  await page.getByRole("button", { name: "Save title" }).click()
  await expect(page.getByText("Title is required.", { exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "Title" }).fill("  Plan the database migration  ")
  await page.getByRole("button", { name: "Save title" }).click()
  await expect(page.getByText("Saved: Plan the database migration", { exact: true })).toBeVisible()
})

story("cancelling an edit does not commit the draft", async ({ visit, page }) => {
  await visit("app-tasks-task-text-editor--title")
  await page.getByRole("textbox", { name: "Title" }).fill("Discard this draft")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByText("Edit cancelled", { exact: true })).toBeVisible()
})
