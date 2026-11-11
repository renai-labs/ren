import { expect, test } from "@playwright/test"
import { Session } from "@ren/schema/session"
import { Schema } from "effect"
import { appOrigin, createOrganization, scriptReply, serverURL } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 90_000 })

test("chat placeholders remain until the first message page arrives", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const listed = await page.request.get(`${serverURL}/spaces?page=1&pageSize=25`)
  expect(listed.ok()).toBe(true)
  const spaces = Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) }))(
    await listed.json(),
  )
  const sessionId = Session.ID.create()
  const created = await page.request.post(`${serverURL}/sessions`, {
    headers: { origin: appOrigin },
    data: { id: sessionId, spaceId: spaces.items[0]?.id },
  })
  expect(created.ok()).toBe(true)
  const held = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<void>()
  await page.route(
    (url) =>
      url.pathname === `/chat/session/${sessionId}/message` || url.pathname === `/sessions/${sessionId}/messages`,
    async (route) => {
      requested.resolve()
      await held.promise
      await route.continue()
    },
  )
  try {
    await page.goto(`/app/sessions/${sessionId}`)
    await requested.promise
    await expect(page.getByRole("button", { name: "Open panel", exact: true })).toBeVisible()
    await expect(page.getByRole("status", { name: "Loading messages", exact: true })).toBeVisible()
    await expect(page.getByText("Help me with this task.", { exact: true })).toBeHidden()
    await page.screenshot({ path: test.info().outputPath("chat-loading-dark.png") })
  } finally {
    held.resolve()
  }
  await expect(page.getByRole("status", { name: "Loading messages", exact: true })).toHaveCount(0)
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible()
})

test("a member starts a chat, follows the reply, sends again, mentions an agent and finds the chat in the sidebar", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const start = page.getByRole("form", { name: "Start a chat" })
  await start.getByRole("textbox", { name: "Message" }).fill("Plan the launch")
  await start.getByRole("button", { name: "Send" }).click()

  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
  const sessionURL = page.url()
  await expect(page.getByText("Plan the launch")).toBeVisible()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  const composer = page.getByRole("form", { name: "Message Ren" })
  await composer.getByRole("textbox", { name: "Message" }).fill("Add the budget")
  await composer.getByRole("textbox", { name: "Message" }).press("Enter")
  await expect(page.getByText("Add the budget")).toBeVisible()
  await expect(page.getByText("stub reply")).toHaveCount(2)

  const message = composer.getByRole("textbox", { name: "Message" })
  await message.pressSequentially("Ask @genera")
  await expect(page.getByRole("listbox", { name: "Mentions" }).getByRole("option")).toHaveText([/^general/])
  await message.press("Enter")
  await message.pressSequentially("to check it")
  await message.press("Enter")
  await expect(page.getByText("Ask @general to check it")).toBeVisible()
  await expect(page.getByText("stub reply")).toHaveCount(3)

  await page.goto("/app/")
  await expect(async () => {
    await page.reload()
    await page.getByRole("link", { name: "Stub title" }).click({ timeout: 1_000 })
  }).toPass()
  await expect(page).toHaveURL(sessionURL)
  await expect(page.getByText("Plan the launch")).toBeVisible()
  await expect(page.getByText("stub reply")).toHaveCount(3)
})

test("a member renames a chat, reverts a message into the composer and restores it", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  await page.goto("/app/")
  const start = page.getByRole("form", { name: "Start a chat" })
  await start.getByRole("textbox", { name: "Message" }).fill("Draft the agenda")
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  await page.getByRole("button", { name: /^Edit Chat title/ }).click()
  await page.getByRole("textbox", { name: "Chat title" }).fill("Board agenda")
  await page.getByRole("textbox", { name: "Chat title" }).press("Enter")
  await expect(page.getByRole("link", { name: "Board agenda" })).toBeVisible()

  const composer = page.getByRole("form", { name: "Message Ren" })
  await page.getByText("Draft the agenda").hover()
  await page.getByRole("button", { name: "Revert to this message" }).click()
  await expect(composer.getByRole("textbox", { name: "Message" })).toHaveValue("Draft the agenda")
  await expect(page.getByText("stub reply")).toHaveCount(0)

  await page.getByRole("button", { name: "Restore messages" }).click()
  await expect(page.getByText("stub reply")).toBeVisible()
  await expect(page.getByRole("button", { name: "Restore messages" })).toHaveCount(0)
})

test("a member opens the model picker with its shortcut and undoes the last message with a command from the + menu", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const start = page.getByRole("form", { name: "Start a chat" })
  await start.getByRole("textbox", { name: "Message" }).fill("Draft the memo")
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  const composer = page.getByRole("form", { name: "Message Ren" })
  const message = composer.getByRole("textbox", { name: "Message" })
  await message.press("ControlOrMeta+'")
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(message).toBeFocused()

  await composer.getByRole("button", { name: "Add to this chat" }).click()
  await page.getByRole("menuitem", { name: "Run a command" }).click()
  await expect(message).toHaveValue("/")
  await message.pressSequentially("und")
  await page
    .getByRole("listbox", { name: "Commands" })
    .getByRole("option", { name: /^\/undo/ })
    .click()
  await expect(message).toHaveValue("Draft the memo")
  await expect(page.getByRole("button", { name: "Restore messages" })).toBeVisible()
})

test("a member finds text in a chat and closes find with Escape", async ({ page }) => {
  await createOrganization(page.request, { name: "Katherine Johnson" })
  await page.goto("/app/")
  const start = page.getByRole("form", { name: "Start a chat" })
  await start.getByRole("textbox", { name: "Message" }).fill("Plan the orbit")
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  await page.keyboard.press("ControlOrMeta+f")
  const find = page.getByRole("searchbox", { name: "Find in chat" })
  await expect(find).toBeFocused()
  await find.fill("STUB")
  await expect(page.getByRole("search", { name: "Find in chat" }).getByRole("status")).toHaveText("1/1")
  await expect.poll(() => page.evaluate<number>('CSS.highlights.get("ren-find-active")?.size ?? 0')).toBe(1)
  await find.press("Escape")
  await expect(find).toHaveCount(0)
})

test("a member edits a sent message, which replaces it and what came after", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const start = page.getByRole("form", { name: "Start a chat" })
  await start.getByRole("textbox", { name: "Message" }).fill("Plan the launch")
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  await page.getByText("Plan the launch").hover()
  await page.getByRole("button", { name: "Edit message" }).click()
  const editor = page.getByRole("textbox", { name: "Edit message" })
  await expect(editor).toHaveValue("Plan the launch")
  await editor.fill("Plan the party")
  await editor.press("Enter")
  await expect(page.getByText("Plan the party")).toBeVisible()
  await expect(page.getByText("Plan the launch")).toHaveCount(0)
  await expect(page.getByText("stub reply")).toHaveCount(1, { timeout: brainStart })
})

test("task list items in a reply render as read-only checkboxes", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const marker = await scriptReply(page.request, "- [x] a\n- [ ] b\n- c\n")
  await page.goto("/app/")
  const start = page.getByRole("form", { name: "Start a chat" })
  await start.getByRole("textbox", { name: "Message" }).fill(`List ${marker}`)
  await start.getByRole("button", { name: "Send" }).click()

  const done = page.getByRole("checkbox", { checked: true })
  const open = page.getByRole("checkbox", { checked: false })
  await expect(page.getByRole("checkbox")).toHaveCount(2, { timeout: brainStart })
  await expect(done).toHaveCount(1)
  await expect(open).toHaveCount(1)
  await expect(done).toHaveAttribute("aria-readonly", "true")
  await expect(open).toHaveAttribute("aria-readonly", "true")
  await open.click()
  await expect(open).not.toBeChecked()
})
