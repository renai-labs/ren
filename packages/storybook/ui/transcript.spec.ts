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

story("follows a running command's output to its latest line, until the reader scrolls back", async ({ visit }) => {
  const root = await visit("ui-transcript--tool-command-live")
  const output = root.getByRole("region", { name: "Output" })
  const more = root.getByRole("button", { name: "Print more" })
  const atEnd = () => output.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight < 2)
  await more.click()
  await more.click()
  await expect(output).toContainText("test 40 passed")
  expect(await atEnd()).toBe(true)
  await output.evaluate((element) => element.scrollTo({ top: 0 }))
  await more.click()
  await expect(output).toContainText("test 60 passed")
  expect(await atEnd()).toBe(false)
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

story("opens a changed file to show its diff, and moves between files with the arrow keys", async ({ visit, page }) => {
  const root = await visit("ui-transcript--file-changes")
  const summary = root.getByRole("button", { name: "src/report/summary.ts, 2 additions, 1 deletion" })
  await expect(root.getByRole("button", { name: "src/report/churn.ts, created" })).toBeVisible()
  await expect(root.getByRole("button", { name: "src/report/legacy.ts, deleted" })).toBeVisible()
  await expect(root.getByRole("region", { name: "Changes in src/report/summary.ts" })).toBeHidden()
  await summary.click()
  await expect(summary).toHaveAttribute("aria-expanded", "true")
  const diff = root.getByRole("region", { name: "Changes in src/report/summary.ts" })
  await expect(diff).toContainText("export const growth = revenue.total * 0.12")
  await expect(diff).toContainText("12 unchanged lines")
  await summary.focus()
  await page.keyboard.press("ArrowDown")
  await expect(root.getByRole("button", { name: "src/report/churn.ts, created" })).toBeFocused()
})

story("highlights a diff once its highlighter loads", async ({ visit }) => {
  const root = await visit("ui-transcript--file-changes")
  await root.getByRole("button", { name: "src/report/summary.ts, 2 additions, 1 deletion" }).click()
  const diff = root.getByRole("region", { name: "Changes in src/report/summary.ts" })
  await expect(diff.locator("code span[style*='--shiki-light']").first()).toBeAttached()
})

story("opens a subagent and names its state", async ({ visit }) => {
  const root = await visit("ui-transcript--subagent-running")
  const card = root.getByRole("button", {
    name: "Explore Find where revenue is computed (background), running",
  })
  await expect(card).toBeEnabled()
  await expect(root.getByText("Needs input")).toBeVisible()
  await expect(root.getByText("└ grep revenue")).toBeVisible()
})

story("says when the member denied a subagent and when a subagent retries", async ({ visit }) => {
  const denied = await visit("ui-transcript--subagent-denied")
  await expect(denied.getByText("Denied", { exact: true })).toBeVisible()
  await expect(denied.getByText("Failed")).toHaveCount(0)
  const retrying = await visit("ui-transcript--subagent-retrying")
  await expect(retrying.getByText("Retrying", { exact: true })).toBeVisible()
  await expect(retrying.getByText("2 tool calls")).toBeVisible()
})

story("lists the first ten links and focuses the next one when shown", async ({ visit }) => {
  const root = await visit("ui-transcript--links")
  const results = root.getByRole("navigation", { name: "Search results" })
  await expect(results.getByRole("link")).toHaveCount(10)
  await results.getByRole("button", { name: "Show 2 more" }).click()
  await expect(results.getByRole("link")).toHaveCount(12)
  await expect(results.getByRole("link", { name: "https://docs.example.com/revenue/11" })).toBeFocused()
})

story("pairs each question with its answer", async ({ visit }) => {
  const root = await visit("ui-transcript--answers")
  await expect(root.getByRole("term").first()).toHaveText("Which package manager should the new workspace use?")
  await expect(root.getByRole("definition").last()).toHaveText("Lint, Typecheck")
})

story("links session IDs and URLs in inline code", async ({ visit }) => {
  const root = await visit("ui-transcript--response-with-links")
  await expect(root.getByRole("button", { name: "ses_01JZ8Q3RVK7M2N4P6S8T0W2Y4A" })).toBeVisible()
  const link = root.getByRole("link", { name: "https://docs.example.com/revenue" })
  await expect(link).toHaveAttribute("href", "https://docs.example.com/revenue")
  await expect(link).toHaveAttribute("target", "_blank")
})

story("keeps mentions in a user message readable in place", async ({ visit }) => {
  const root = await visit("ui-transcript--user-text")
  await expect(root.getByText("Ask @review to check @src/report/summary.ts before Friday")).toBeVisible()
})
