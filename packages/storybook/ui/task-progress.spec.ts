import { expect, story } from "../support/story.js"

story("shows the task in progress and how many are done", async ({ visit }) => {
  const root = await visit("ui-task-progress--collapsed")
  const tasks = root.getByRole("region", { name: "Tasks" })
  await expect(
    tasks.getByRole("button", { name: "Compare revenue with the forecast for each region 1 of 4 done" }),
  ).toHaveAttribute("aria-expanded", "false")
  await expect(tasks.getByRole("listitem")).toHaveCount(0)
})

story("lists every task with its status when opened", async ({ visit }) => {
  const root = await visit("ui-task-progress--collapsed")
  await root.getByRole("button", { name: /1 of 4 done/ }).click()
  const items = root.getByRole("listitem")
  await expect(items).toHaveText([
    "Read the quarterly revenue report, completed",
    "Compare revenue with the forecast for each region, in progress",
    "Draft the summary for the finance team, pending",
    "Book the review meeting, cancelled",
  ])
  await root.getByRole("button", { name: /1 of 4 done/ }).press("Enter")
  await expect(items).toHaveCount(0)
})

story("shows the next pending task before any starts", async ({ visit }) => {
  const root = await visit("ui-task-progress--pending")
  await expect(root.getByRole("button", { name: "Read the quarterly revenue report 0 of 2 done" })).toBeVisible()
})

story("shows the last task once all are done", async ({ visit }) => {
  const root = await visit("ui-task-progress--finished")
  await expect(root.getByRole("button", { name: "Draft the summary for the finance team 2 of 2 done" })).toBeVisible()
})
