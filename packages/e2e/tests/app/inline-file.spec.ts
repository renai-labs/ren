import { expect, test } from "@playwright/test"
import { createOrganization, script } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

test("Ren's reply shows a file it names, in code or in plain text, as a chip that opens it, and leaves a missing file as text", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill("Set up the project")
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  await page.getByRole("button", { name: "Open panel", exact: true }).click()
  const panel = page.getByRole("complementary", { name: "Workspace" })
  await panel.getByRole("button", { name: /^Terminal:/ }).click()
  const command = panel.getByRole("textbox", { name: "Terminal" })
  await command.fill("printf '# Notes\\n' > README.md && echo created")
  await command.press("Enter")
  await expect(panel.getByText("created", { exact: true })).toBeVisible()

  const marker = await script(page.request, { reply: "Read `README.md` and not `missing.ts`." })
  await message.fill(`Name two files ${marker}`)
  await message.press("Enter")
  const reply = page.getByRole("main").getByText(/^Read/)
  await expect(reply).toBeVisible({ timeout: brainStart })
  await expect(reply.getByRole("button", { name: "README.md", exact: true })).toHaveText("README.md")
  await expect(reply.locator("code", { hasText: "missing.ts" })).toBeVisible()
  await expect(reply.getByRole("button", { name: "missing.ts" })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath("inline-file.png") })

  const plain = await script(page.request, { reply: "Your notes are in README.md, not in missing.ts." })
  await message.fill(`Where are the notes ${plain}`)
  await message.press("Enter")
  const answer = page.getByRole("main").getByText(/^Your notes/)
  await expect(answer).toBeVisible({ timeout: brainStart })
  await expect(answer.getByRole("button", { name: "README.md", exact: true })).toHaveText("README.md")
  await expect(answer.getByRole("button", { name: "missing.ts" })).toHaveCount(0)
  await answer.getByRole("button", { name: "README.md", exact: true }).click()
  await expect(panel.getByText("README.md").first()).toBeVisible()
})
