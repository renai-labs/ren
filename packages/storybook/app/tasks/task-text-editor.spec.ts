import { expect, story } from "../../support/story.js"

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
