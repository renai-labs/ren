import { expect, test } from "@playwright/test"
import { createOrganization, scriptedReply } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

test("a member runs a command from the composer's shell mode and recalls it with the up arrow", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill("Set up the project")
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  await message.fill("!")
  const command = page.getByRole("main").getByRole("textbox", { name: "Command" })
  await expect(command).toHaveValue("")
  await expect(command).toHaveAttribute("placeholder", "e.g. git status")
  await expect(page.getByRole("button", { name: "Run command", exact: true })).toBeVisible()
  await command.fill("echo hi")
  await command.press("Enter")
  await page.getByRole("button", { name: "Worked 1 step" }).click({ timeout: brainStart })
  await page.getByRole("button", { name: "Ran echo hi", exact: true }).click({ timeout: brainStart })
  await expect(page.getByRole("region", { name: "Messages" }).getByText("hi", { exact: true })).toBeVisible()
  await expect(page.getByText("Couldn’t run the command")).toHaveCount(0)
  await expect(command).toHaveValue("")

  await command.press("ArrowUp")
  await expect(command).toHaveValue("echo hi")

  await page.reload()
  await expect(page.getByRole("main").getByRole("textbox", { name: "Command" })).toHaveValue("echo hi")
  await page.getByRole("main").getByRole("textbox", { name: "Command" }).fill("")
  await page.keyboard.press("Backspace")
  await expect(page.getByRole("main").getByRole("textbox", { name: "Message" })).toBeVisible()
})

test("a member runs a command from a bash fence: Run fills the composer in shell mode and Enter runs it", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const marker = await scriptedReply(page.request, "```bash\necho from-fence\n```")
  await page.goto("/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill(`Show the command ${marker}`)
  await message.press("Enter")
  const block = page.locator("[data-slot=code-block]")
  await expect(block).toContainText("echo from-fence", { timeout: brainStart })

  await page.getByRole("main").getByRole("textbox", { name: "Message" }).fill("my draft")
  await block.hover()
  await block.getByRole("button", { name: "Run" }).click()
  await page.getByRole("dialog", { name: "Replace your draft?" }).getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("main").getByRole("textbox", { name: "Message" })).toHaveValue("my draft")

  await block.hover()
  await block.getByRole("button", { name: "Run" }).click()
  await page.getByRole("dialog", { name: "Replace your draft?" }).getByRole("button", { name: "Replace" }).click()
  const command = page.getByRole("main").getByRole("textbox", { name: "Command" })
  await expect(command).toHaveValue("echo from-fence")
  await expect(command).toBeFocused()
  await command.press("Enter")
  await page.getByRole("button", { name: "Worked 1 step" }).click({ timeout: brainStart })
  await expect(page.getByRole("button", { name: "Ran echo from-fence", exact: true })).toBeVisible({
    timeout: brainStart,
  })
})
