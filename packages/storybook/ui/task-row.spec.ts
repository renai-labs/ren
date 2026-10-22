import { expect, story } from "../support/story.js"

story("selecting a task does not open it; its title opens from the keyboard", async ({ visit, page }) => {
  await visit("ui-task-row--default")
  await page.getByRole("checkbox", { name: "Select task" }).check()
  await expect(page.getByText("Task list", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Plan the migration" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Opened task", { exact: true })).toBeVisible()
})

story("a click on the row’s empty space opens the task", async ({ visit, page }) => {
  await visit("ui-task-row--default")
  const row = page.getByRole("listitem")
  const box = await row.boundingBox()
  await row.click({ position: { x: (box?.width ?? 0) - 8, y: (box?.height ?? 0) / 2 } })
  await expect(page.getByText("Opened task", { exact: true })).toBeVisible()
})
