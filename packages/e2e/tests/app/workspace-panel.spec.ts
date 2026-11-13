import { expect, test, type Page } from "@playwright/test"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Schema } from "effect"
import { appOrigin, createOrganization, script, serverURL } from "../lib/servers.js"

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
  const first = page.waitForRequest(
    (request) => request.method() === "POST" && request.url() === `${serverURL}/sessions`,
  )
  await message.press("Enter")
  const model = Schema.decodeUnknownSync(Schema.Struct({ model: Schema.optional(Schema.Unknown) }))(
    (await first).postDataJSON(),
  ).model
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
  await panel.getByRole("treeitem", { name: "src", exact: true }).click()
  await panel.getByRole("treeitem", { name: "answer.ts", exact: true }).click()
  await expect(panel.getByText("export const answer = 42")).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("files.png") })

  await panel.getByRole("treeitem", { name: "answer.ts", exact: true }).dblclick()
  await panel.getByRole("treeitem", { name: "question.ts", exact: true }).dblclick()
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
  await panel.getByRole("treeitem", { name: "question.ts", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Wrap lines" })).toHaveAttribute("aria-pressed", "true")

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
      model,
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

test("a member opens a file from its chip in the chat, and copies its path from the chip's menu", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await createOrganization(page.request, { name: "Grace Hopper" })
  const marker = await script(page.request, {
    tools: [{ name: "write", input: { path: "src/answer.ts", content: "export const answer = 42\n" } }],
  })
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
  await expect(panel.getByRole("treeitem", { name: "answer.ts", exact: true })).toHaveAttribute("aria-selected", "true")

  await page.mouse.move(0, 0)
  await chip.hover()
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("src/answer.ts")
  await chip.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Copy path" }).click()
  await expect(page.getByText("Path copied")).toBeVisible()
  expect(await page.evaluate("navigator.clipboard.readText()")).toBe("src/answer.ts")

  await chip.focus()
  await chip.press("Shift+F10")
  await expect(page.getByRole("menuitem", { name: "Open in Files" })).toBeVisible()
  await page.keyboard.press("Escape")
})

test("a member opens a nested folder, finds a file that is not loaded yet and drags a file onto the composer", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Katherine Johnson" })
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
    "mkdir -p packages/app/src packages/chat && printf 'one\\n' > packages/app/src/deep.ts && printf 'two\\n' > packages/chat/index.ts && printf 'hello\\n' > README.md && echo seeded",
  )
  await expect(panel.getByText("seeded", { exact: true })).toBeVisible()

  await openTab(page, "Files")
  await expect(panel.getByText("This folder is empty")).toBeHidden()
  await panel.getByRole("treeitem", { name: "packages", exact: true }).click()
  await panel.getByRole("treeitem", { name: "chat", exact: true }).click()
  await expect(panel.getByRole("treeitem", { name: "index.ts", exact: true })).toBeVisible()
  await expect(panel.getByRole("treeitem", { name: "deep.ts", exact: true })).toBeHidden()

  await panel.getByRole("button", { name: "Collapse all" }).click()
  await expect(panel.getByRole("treeitem", { name: "index.ts", exact: true })).toBeHidden()

  const search = panel.getByRole("searchbox", { name: "Search files" })

  await expect(async () => {
    await search.fill("")
    await search.fill("deep")
    await expect(panel.getByRole("treeitem", { name: "deep.ts", exact: true })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await panel.getByRole("treeitem", { name: "deep.ts", exact: true }).click()
  await expect(panel.getByText("one", { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("search.png") })

  await search.fill("")
  await panel.getByRole("treeitem", { name: "README.md", exact: true }).click({ button: "right" })
  await expect(panel.getByRole("menuitem")).toHaveText(["Open", "Copy path", "Mention in prompt", "Reveal in terminal"])
  await page.screenshot({ path: test.info().outputPath("menu.png") })
  await panel.getByRole("menuitem", { name: "Mention in prompt" }).click()
  await expect(message).toHaveValue("@  README.md ")

  await message.fill("")
  const uploads: Array<string> = []
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/drive")) uploads.push(request.url())
  })
  await panel.getByRole("button", { name: "Expand loaded" }).click()
  await panel.getByRole("treeitem", { name: "index.ts", exact: true }).dragTo(message)
  await expect(message).toHaveValue("@  packages/chat/index.ts ")
  await expect(page.getByText("Drop files to attach")).toBeHidden()
  await page.screenshot({ path: test.info().outputPath("drop.png") })
  expect(uploads).toEqual([])
})
