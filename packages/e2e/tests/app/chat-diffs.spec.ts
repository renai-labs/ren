import { expect, test } from "@playwright/test"
import { createOrganization, script } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 60_000 })

test("an edit by Ren shows as a diff with line numbers, and Open in Changes shows that file's diffs", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const marker = await script(page.request, {
    reply: "notes edited",
    tools: [
      { name: "write", input: { path: "notes.md", content: "alpha\n" } },
      { name: "edit", input: { path: "notes.md", oldString: "alpha\n", newString: "beta\n" } },
      { name: "edit", input: { path: "notes.md", oldString: "beta\n", newString: "gamma\n" } },
    ],
  })

  await page.goto("/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill(`${marker} change the notes`)
  await message.press("Enter")
  await expect(page.getByText("notes edited")).toBeVisible({ timeout: brainStart })

  await page.getByRole("button", { name: /^Worked for/ }).click()
  await page
    .getByRole("button", { name: /^Edited notes\.md/ })
    .first()
    .click()
  const diff = page.locator('[data-slot="file-diff"]')
  await expect(diff).toHaveCount(1)
  await expect(diff.getByText("beta")).toBeVisible()
  await expect(diff.locator("[data-column-number]").first()).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("transcript-diff.png") })

  await diff.getByRole("button", { name: "Open in Changes" }).click()
  const panel = page.getByRole("complementary", { name: "Workspace" })
  await expect(panel.getByText("1 file")).toBeVisible()
  await expect(panel.locator('[data-slot="file-diff"]')).toHaveCount(3)
  await expect(panel.getByText("gamma")).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("changes-diff.png") })
})

test("a diff above 200 changed lines renders only the lines in view", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const content = `${Array.from({ length: 600 }, (_, index) => `row ${index + 1}`).join("\n")}\n`
  const marker = await script(page.request, {
    reply: "big file written",
    tools: [{ name: "write", input: { path: "big.txt", content } }],
  })

  await page.goto("/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill(`${marker} write the big file`)
  await message.press("Enter")
  await expect(page.getByText("big file written")).toBeVisible({ timeout: brainStart })

  await page.getByRole("button", { name: /^Worked for/ }).click()
  await page
    .getByRole("button", { name: /^Wrote big\.txt/ })
    .first()
    .click()
  const diff = page.locator('[data-slot="file-diff"]')
  await expect(diff.getByText("row 1", { exact: true })).toBeVisible()
  await expect.poll(() => diff.locator("[data-line]").count()).toBeGreaterThan(0)
  expect(await diff.locator("[data-line]").count()).toBeLessThan(600)
  await page.screenshot({ path: test.info().outputPath("large-diff.png") })
})
