import { expect, test, type Page } from "@playwright/test"
import { createOrganization, script } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

const send = async (page: Page, marker: string) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill(`${marker} wait`)
  await message.press("Enter")
}

const shellTurn = async (page: Page) => {
  const marker = await script(page.request, {
    tools: [{ name: "shell", input: { command: "echo started; sleep 30", description: "Wait" } }],
  })
  await send(page, marker)
  return page.getByRole("button", { name: "1 shell" })
}

test("a running shell shows in the activity pill, its output opens in place, and Stop ends it", async ({ page }) => {
  const pill = await shellTurn(page)
  await expect(pill).toBeVisible({ timeout: brainStart })
  await pill.click()
  await page.getByRole("menuitem", { name: /echo started; sleep 30/ }).click()
  await expect(page.getByRole("menuitem", { name: "Back to background work" })).toBeVisible()
  await expect(page.getByText("started", { exact: true })).toBeVisible()
  await page.getByRole("menuitem", { name: "Stop", exact: true }).click()
  await expect(page.locator("output").filter({ hasText: "Stopped" })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("background-activity.png") })
})

test("Move to background lets the turn end while the shell keeps running", async ({ page }) => {
  const pill = await shellTurn(page)
  const move = page.getByRole("button", { name: "Press Ctrl+B to move running work to the background" })
  await expect(move).toBeVisible({ timeout: brainStart })
  await move.click()
  await expect(page.getByText("stub reply").first()).toBeVisible({ timeout: brainStart })
  await expect(pill).toBeVisible()
  await expect(move).toHaveAttribute("inert")
  await expect(page.getByRole("button", { name: /^Running in background/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Worked.*0 steps/ })).toHaveCount(0)
})

test("a running subagent shows in the activity pill and its row opens the subagent view", async ({ page }) => {
  const child = await script(page.request, {
    tools: [{ name: "shell", input: { command: "sleep 30", description: "Wait" } }],
  })
  const parent = await script(page.request, {
    tools: [{ name: "subagent", input: { agent: "general", description: "Look around", prompt: `${child} look` } }],
  })
  await send(page, parent)
  const pill = page.getByRole("button", { name: "1 subagent" })
  await expect(pill).toBeVisible({ timeout: brainStart })
  await pill.click()
  const row = page.getByRole("menuitem", { name: /General.*Look around/ })
  await expect(row).toBeVisible()
  await row.click()
  await expect(page).toHaveURL(/child=/)
  await expect(pill).toBeHidden()
})

test("Delete on a subagent row interrupts it and the pill goes", async ({ page }) => {
  const child = await script(page.request, {
    tools: [{ name: "shell", input: { command: "sleep 60", description: "Wait" } }],
  })
  const parent = await script(page.request, {
    tools: [{ name: "subagent", input: { agent: "general", description: "Look around", prompt: `${child} look` } }],
  })
  await send(page, parent)
  const pill = page.getByRole("button", { name: "1 subagent" })
  await expect(pill).toBeVisible({ timeout: brainStart })
  await pill.click()
  const row = page.getByRole("menuitem", { name: /General.*Look around/ })
  await row.focus()
  await row.press("Delete")
  await expect(pill).toBeHidden()
})
