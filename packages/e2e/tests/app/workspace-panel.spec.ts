import { expect, test, type Page } from "@playwright/test"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Schema } from "effect"
import { appOrigin, createOrganization, scriptTools, serverURL } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

const run = async (page: Page, command: string) => {
  const input = page.getByRole("complementary", { name: "Workspace" }).getByRole("textbox", { name: "Command" })
  await input.fill(command)
  await input.press("Enter")
}

const openTab = async (page: Page, label: string) => {
  const panel = page.getByRole("complementary", { name: "Workspace" })
  await panel.getByRole("button", { name: "Open a tab" }).click()
  await page.getByRole("option", { name: label, exact: true }).click()
}

test("a member runs commands in the chat's terminal, browses and opens its files, and reviews its repository's changes", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill("Set up the project")
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  await page.getByRole("button", { name: "Open panel", exact: true }).click()
  const panel = page.getByRole("complementary", { name: "Workspace" })
  await panel.getByRole("button", { name: /^Terminal:/ }).click()
  await run(
    page,
    "mkdir -p src && printf 'export const answer = 42\\n' > src/answer.ts && printf 'export const question = 6 * 7 // wizard\\n' > question.ts && echo created",
  )
  await expect(panel.getByText("created", { exact: true })).toBeVisible()
  await run(page, "ls src; exit 3")
  await expect(panel.getByText("answer.ts", { exact: true })).toBeVisible()
  await expect(panel.getByText("Exit 3", { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("terminal.png") })

  await openTab(page, "Files")
  await panel.getByRole("button", { name: "src", exact: true }).click()
  await panel.getByRole("button", { name: "answer.ts", exact: true }).click()
  await expect(panel.getByText("export const answer = 42")).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("files.png") })

  await panel.getByRole("button", { name: "answer.ts", exact: true }).dblclick()
  await panel.getByRole("button", { name: "Open the parent folder" }).click()
  await panel.getByRole("button", { name: "question.ts", exact: true }).dblclick()
  await expect(panel.getByRole("tab", { name: "answer.ts" })).toBeVisible()
  await expect(panel.getByRole("tab", { name: "question.ts" })).toBeVisible()
  await panel.getByRole("button", { name: "Close answer.ts" }).click()
  await expect(panel.getByRole("tab", { name: "answer.ts" })).toHaveCount(0)
  await panel.getByText("export const question").click()
  await page.keyboard.press("ControlOrMeta+f")
  await panel.getByRole("searchbox", { name: "Find in file" }).fill("wizard")
  await expect(panel.getByText("1/1", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Close find" }).click()
  await panel.getByRole("button", { name: "Wrap lines" }).click()
  await expect(panel.getByRole("button", { name: "Wrap lines" })).toHaveAttribute("aria-pressed", "true")
  await page.reload()
  await page.getByRole("button", { name: "Open panel", exact: true }).click()
  await panel.getByRole("button", { name: /^Files:/ }).click()
  await panel.getByRole("button", { name: "question.ts", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Wrap lines" })).toHaveAttribute("aria-pressed", "true")
  await panel.getByRole("button", { name: "Open a tab" }).click()
  await page.getByRole("option", { name: "Terminal", exact: true }).click()

  const repository = Session.ID.create()
  await panel.getByRole("tab", { name: "Terminal" }).click()
  await run(
    page,
    [
      `mkdir ../${repository} && cd ../${repository}`,
      "git init -q -b main && printf 'one\\n' > notes.md && git add .",
      "git -c user.email=ren@example.com -c user.name=Ren commit -qm first",
      "printf 'two\\n' > notes.md && printf 'new\\n' > todo.md && echo ready",
    ].join(" && "),
  )
  await expect(panel.getByText("ready", { exact: true })).toBeVisible()

  const spaces = Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) }))(
    await (await page.request.get(`${serverURL}/spaces?page=1&pageSize=25`)).json(),
  )
  const created = await page.request.post(`${serverURL}/sessions`, {
    headers: { origin: appOrigin },
    data: {
      id: repository,
      spaceId: spaces.items[0]?.id,
      message: { id: SessionMessage.ID.create(), text: "Review the notes" },
    },
  })
  expect(created.ok()).toBe(true)
  await page.goto(`/app/sessions/${repository}`)
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
  await page.getByRole("button", { name: "Open panel", exact: true }).click()
  await panel.getByRole("button", { name: /^Changes:/ }).click()
  await expect(panel.getByRole("button", { name: "Repository", exact: true })).toBeVisible()
  await expect(panel.getByText("2 files")).toBeVisible()
  await expect(panel.getByText("main", { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("changes.png") })
})

test("a member opens a file from its chip in the chat, copies its path from the chip's menu, and keeps the file open after a reload", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await createOrganization(page.request, { name: "Grace Hopper" })
  const marker = await scriptTools(page.request, [
    { name: "write", input: { path: "src/answer.ts", content: "export const answer = 42\n" } },
  ])
  await page.goto("/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill(`Write the answer ${marker}`)
  await message.press("Enter")
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  const chat = page.getByRole("main")
  await chat.getByRole("button", { name: /^Worked for/ }).click()
  await chat
    .getByRole("button", { name: /answer\.ts/ })
    .first()
    .click()
  const chip = chat.getByRole("button", { name: "src/answer.ts", exact: true })
  const panel = page.getByRole("complementary", { name: "Workspace" })
  await chip.click()
  await expect(panel.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true")
  await expect(panel.getByText("export const answer = 42")).toBeVisible()
  await expect(page).toHaveURL(/panel=files/)
  await expect(page).toHaveURL(/file=src%2Fanswer\.ts/)

  await page.mouse.move(0, 0)
  await chip.hover()
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("src/answer.ts")
  await chip.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Copy path" }).click()
  await expect(page.getByText("Copied path")).toBeVisible()
  expect(await page.evaluate("navigator.clipboard.readText()")).toBe("src/answer.ts")

  await chip.focus()
  await chip.press("Shift+F10")
  await expect(page.getByRole("menuitem", { name: "Open in Files" })).toBeVisible()
  await page.keyboard.press("Escape")

  await page.reload()
  await expect(panel.getByText("export const answer = 42")).toBeVisible()
})
