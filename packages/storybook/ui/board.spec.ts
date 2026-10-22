import { expect, story } from "../support/story.js"

story("card controls stay independent of surface and keyboard navigation", async ({ visit, page }) => {
  await visit("ui-board--navigation")
  await page.getByRole("button", { name: "Update task", exact: true }).click()
  await expect(page.getByText("Updated task", { exact: true })).toBeVisible()
  await expect(page.getByText("Task board", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Plan the migration", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Opened task", { exact: true })).toBeVisible()
  await visit("ui-board--navigation")
  await page.getByText("RENAI-123", { exact: true }).click()
  await expect(page.getByText("Opened task", { exact: true })).toBeVisible()
})
