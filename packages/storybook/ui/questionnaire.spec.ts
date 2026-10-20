import { expect, story } from "../support/story.js"

story("submits the chosen answer", async ({ visit }) => {
  const root = await visit("ui-questionnaire--permission")
  const question = root.getByRole("group", { name: "Allow Ren to run this command?" })
  await question.getByRole("radio", { name: "Allow once" }).click()
  await root.getByRole("button", { name: "Continue" }).click()
  await expect(root.getByRole("status").filter({ hasText: "Answer sent" })).toContainText("permission: Allow once")
})

story("asks for an answer before it submits", async ({ visit }) => {
  const root = await visit("ui-questionnaire--permission")
  await root.getByRole("button", { name: "Continue" }).click()
  await expect(root.getByRole("alert")).toHaveText("Choose an answer to continue.")
  await expect(root.getByRole("radio", { name: "Allow once" })).toBeFocused()
  await expect(root.getByText("Answer sent")).toBeHidden()
  await root.getByRole("radio", { name: "Deny" }).click()
  await expect(root.getByRole("alert")).toBeHidden()
})

story("chooses and submits with the keyboard", async ({ visit, page }) => {
  const root = await visit("ui-questionnaire--permission")
  await page.keyboard.press("Tab")
  await expect(root.getByRole("radio", { name: "Allow once" })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(root.getByRole("radio", { name: "Always allow" })).toBeChecked()
  await page.keyboard.press("Enter")
  await expect(root.getByRole("status").filter({ hasText: "Answer sent" })).toContainText("permission: Always allow")
})

story("moves between the choices and the typed answer with the arrow keys", async ({ visit, page }) => {
  const root = await visit("ui-questionnaire--permission")
  const answer = root.getByRole("textbox", { name: "Deny and tell Ren what to do instead" })
  await page.keyboard.press("Tab")
  await page.keyboard.press("ArrowUp")
  await expect(answer).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(root.getByRole("radio", { name: "Allow once" })).toBeChecked()
  await page.keyboard.press("ArrowUp")
  await page.keyboard.type("Use the dev script")
  await page.keyboard.press("Enter")
  await expect(root.getByRole("status").filter({ hasText: "Answer sent" })).toContainText(
    "instructions: Use the dev script",
  )
})

story("sends a typed answer in place of a choice, under its own name", async ({ visit }) => {
  const root = await visit("ui-questionnaire--permission")
  await root.getByRole("radio", { name: "Allow once" }).click()
  await root
    .getByRole("textbox", { name: "Deny and tell Ren what to do instead" })
    .fill("Run only the questionnaire spec")
  await expect(root.getByRole("radio", { name: "Allow once" })).not.toBeChecked()
  await root.getByRole("button", { name: "Continue" }).click()
  await expect(root.getByRole("status").filter({ hasText: "Answer sent" })).toContainText(
    "instructions: Run only the questionnaire spec",
  )
})

story("steps through the questions and keeps each answer", async ({ visit }) => {
  const root = await visit("ui-questionnaire--multi-step")
  const progress = root.getByRole("progressbar", { name: "Questionnaire progress" })
  await expect(progress).toContainText("1 of 2")
  await expect(root.getByRole("button", { name: "Back" })).toBeHidden()
  await root.getByRole("button", { name: "Next" }).click()
  await expect(root.getByRole("alert")).toHaveText("Choose an answer or skip this question.")
  await root.getByRole("radio", { name: "Bun" }).click()
  await root.getByRole("button", { name: "Next" }).click()
  await expect(progress).toContainText("2 of 2")
  const checks = root.getByRole("group", { name: "Which checks should run before each commit?" })
  await checks.getByRole("checkbox", { name: "Lint" }).click()
  await checks.getByRole("checkbox", { name: "Unit tests" }).click()
  await root.getByRole("button", { name: "Back" }).click()
  await expect(progress).toContainText("1 of 2")
  await expect(root.getByRole("radio", { name: "Bun" })).toBeChecked()
  await root.getByRole("button", { name: "Next" }).click()
  await expect(checks.getByRole("checkbox", { name: "Lint" })).toBeChecked()
  await root.getByRole("button", { name: "Submit" }).click()
  await expect(root.getByRole("status").filter({ hasText: "Answer sent" })).toContainText(
    "q0: Bun, q1: Lint, q1: Unit tests",
  )
})

story("leaves a skipped question out of the answers", async ({ visit }) => {
  const root = await visit("ui-questionnaire--multi-step")
  await root.getByRole("button", { name: "Skip" }).click()
  await root.getByRole("checkbox", { name: "Typecheck" }).click()
  await root.getByRole("button", { name: "Submit" }).click()
  await expect(root.getByRole("status").filter({ hasText: "Answer sent" })).toHaveText(/Answer sent\s*q1: Typecheck$/)
})

story("blocks every answer while a reply is in flight", async ({ visit }) => {
  const root = await visit("ui-questionnaire--pending")
  const submit = root.getByRole("button", { name: "Continue" })
  await expect(submit).toBeDisabled()
  await expect(submit).toHaveAttribute("aria-busy", "true")
  await expect(root.getByRole("radio", { name: "Allow once" })).toBeDisabled()
  await expect(root.getByRole("textbox", { name: "Deny and tell Ren what to do instead" })).not.toBeEditable()
})

story("dismisses with Escape", async ({ visit, page }) => {
  const root = await visit("ui-questionnaire--dismissible")
  await root.getByRole("radio", { name: "Bun" }).focus()
  await page.keyboard.press("Escape")
  await expect(root.getByRole("status").filter({ hasText: "Dismissed" })).toBeVisible()
})

story("goes back a question with the back shortcut", async ({ visit, page }) => {
  const root = await visit("ui-questionnaire--dismissible")
  const progress = root.getByRole("progressbar", { name: "Questionnaire progress" })
  await root.getByRole("radio", { name: "Bun" }).click()
  await root.getByRole("button", { name: "Next" }).click()
  await expect(progress).toContainText("2 of 2")
  const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.userAgent))
  await page.keyboard.press(apple ? "Meta+BracketLeft" : "Alt+ArrowLeft")
  await expect(progress).toContainText("1 of 2")
  await expect(root.getByRole("radio", { name: "Bun" })).toBeChecked()
})

story("restores saved progress and reports each change", async ({ visit }) => {
  const root = await visit("ui-questionnaire--saved-progress")
  await expect(root.getByRole("progressbar", { name: "Questionnaire progress" })).toContainText("2 of 2")
  await expect(root.getByRole("checkbox", { name: "Lint" })).toBeChecked()
  await root.getByRole("checkbox", { name: "Typecheck" }).click()
  await expect(root.getByRole("status").filter({ hasText: "Saved" })).toContainText(
    "Step 2: q0 Bun, q1 Lint, Typecheck",
  )
})

story("minimizes to the question and expands again", async ({ visit }) => {
  const root = await visit("ui-questionnaire--dismissible")
  await root.getByRole("button", { name: "Minimize question" }).click()
  await expect(root.getByRole("radio", { name: "Bun" })).toBeHidden()
  await expect(root.getByText("Which package manager should the new workspace use?")).toBeVisible()
  await root.getByRole("button", { name: "Expand question" }).click()
  await expect(root.getByRole("radio", { name: "Bun" })).toBeVisible()
})
