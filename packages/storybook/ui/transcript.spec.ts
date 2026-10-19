import { expect, story } from "../support/story.js"

story("names a tool call by its action, subject and progress", async ({ visit }) => {
  const root = await visit("ui-transcript--tool-running")
  await expect(root.getByRole("button", { name: "Reading revenue.csv, running" })).toBeVisible()
})

story("opens a tool call to show its input and output", async ({ visit }) => {
  const root = await visit("ui-transcript--tool")
  const trigger = root.getByRole("button", { name: "Read revenue.csv, completed" })
  await expect(root.getByRole("region", { name: "Output" })).toBeHidden()
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(root.getByRole("region", { name: "Input" })).toContainText("/data/revenue.csv")
  await expect(root.getByRole("region", { name: "Output" })).toContainText("enterprise,Q3,1200000")
})

story("marks a failed tool call and shows its error", async ({ visit }) => {
  const root = await visit("ui-transcript--tool-failed")
  await expect(root.getByText("File not found", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Reading revenue.csv, file not found" }).click()
  await expect(root.getByRole("region", { name: "Error" })).toContainText("File not found")
})

story("keeps a working group open until it finishes", async ({ visit }) => {
  const root = await visit("ui-transcript--tool-group-working")
  await expect(root.getByRole("button", { name: "Searching src, running" })).toBeVisible()
  await expect(root.getByRole("button", { name: "Used 1 Grep, running" })).toBeDisabled()
})

story("collapses a finished group until it is opened", async ({ visit }) => {
  const root = await visit("ui-transcript--tool-group")
  await expect(root.getByRole("button", { name: "Read revenue.csv, completed" })).toBeHidden()
  await root.getByRole("button", { name: "Used 2 Read and Grep" }).click()
  await expect(root.getByRole("button", { name: "Read revenue.csv, completed" })).toBeVisible()
  await expect(root.getByRole("button", { name: "Searched src, completed" })).toBeVisible()
})

story("shows the live heading while reasoning streams", async ({ visit }) => {
  const root = await visit("ui-transcript--reasoning-streaming")
  const trigger = root.getByRole("button", { name: "Thinking Checking the revenue sources" })
  await expect(trigger).toBeVisible()
  await trigger.click()
  await expect(root.getByRole("button", { name: "Thinking", exact: true })).toHaveAttribute("aria-expanded", "true")
})

story("shows how long finished reasoning took and opens to its text", async ({ visit }) => {
  const root = await visit("ui-transcript--reasoning")
  await root.getByRole("button", { name: "Thought 4s" }).click()
  await expect(root.getByText("The finance export has one row per invoice", { exact: false })).toBeVisible()
})

story("reveals a streamed response until it shows all of it", async ({ visit }) => {
  const root = await visit("ui-transcript--response-streaming")
  await expect(root.getByText("The report is ready.", { exact: false })).toBeVisible()
  await root.getByRole("button", { name: "Stream the rest" }).click()
  await expect(root.getByText("Expansion revenue doubled in the EMEA region")).toBeVisible()
  await root.getByRole("button", { name: "Finish" }).click()
  await expect(root.getByText("Churn fell from 3.1% to 2.4%")).toBeVisible()
})

story("shows a response at once when motion is reduced", async ({ visit, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const root = await visit("ui-transcript--response-streaming")
  await root.getByRole("button", { name: "Stream the rest" }).click()
  await expect(root.getByText("Expansion revenue doubled in the EMEA region")).toBeVisible({ timeout: 500 })
})

story("counts down to the next retry", async ({ visit, page }) => {
  await page.clock.install({ time: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)) })
  await page.clock.pauseAt(new Date(Date.UTC(2026, 0, 1, 12, 0, 5)))
  const root = await visit("ui-transcript--retry")
  await expect(root.getByRole("status")).toContainText("The model provider is overloaded")
  await expect(root.getByRole("status")).toContainText("Attempt 2, retrying in 5s")
  await page.clock.runFor(6000)
  await expect(root.getByRole("status")).toContainText("Attempt 2, retrying now")
})

story("announces that Ren is working", async ({ visit }) => {
  const root = await visit("ui-transcript--working")
  await expect(root.getByRole("status")).toHaveText("Preparing the next step")
})
