import { expect, test } from "@playwright/test"
import { Ren } from "@ren/client"
import { Session } from "@ren/schema/session"
import { appURL, createOrganization, serverURL } from "../lib/servers.js"

test("mentions settings shows live connection states and removes the prototype navigation", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  await page.goto("/app/settings/channels")
  await expect(page.getByRole("heading", { level: 1, name: "@mentions", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Mentions lab" })).toBeHidden()
  await expect(page.getByText("Connected", { exact: true })).toBeHidden()
  await page.goto("/app/settings/channels/slack")
  await expect(page.getByRole("heading", { level: 1, name: "Slack", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Disconnect Slack", exact: true })).toBeHidden()
  await expect(page.getByRole("table")).toBeHidden()
  await page.getByRole("link", { name: "Back to @mentions" }).click()
  await expect(page).toHaveURL(/\/settings\/channels$/)
})

test("closing punctuation stays on the line of the app pill it follows", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const cookie = (await page.request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ")
  const ren = Ren.make({ baseUrl: serverURL, headers: { cookie } })
  const zeta = await ren["app-registry"].get({ idOrSlug: "zz-notes" })
  await ren["app-profile"].create({ appId: zeta.id, name: "Mine", slug: "zz-notes", kind: "private" })

  await page.goto("/app/")
  const start = page.getByRole("main")
  const filler = "then ask Ren to open a pull request and write the notes on"
  await start.getByRole("textbox", { name: "Message" }).fill(`${filler} @zz-notes.`)
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: 30_000 })

  const chip = page.locator("[data-chip]", { hasText: /\.$/ }).filter({ has: page.getByText("Zeta Notes") })
  await expect(chip).toHaveCount(1)
  for (const width of [900, 700, 560, 480, 420, 380, 340, 320]) {
    await page.setViewportSize({ width, height: 800 })
    const lines = await chip.evaluate((node) => {
      const stop = node.ownerDocument.createRange()
      stop.selectNodeContents(node.lastChild ?? node)
      const pill = node.firstElementChild?.getBoundingClientRect() ?? node.getBoundingClientRect()
      const mark = stop.getBoundingClientRect()
      return { mark: (mark.top + mark.bottom) / 2, top: pill.top, bottom: pill.bottom }
    })
    expect(lines.mark, `width ${width}`).toBeGreaterThan(lines.top)
    expect(lines.mark, `width ${width}`).toBeLessThan(lines.bottom)
  }
})

test("a member mentions a task and another chat through the @ categories, and the message names both", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const cookie = (await page.request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ")
  const ren = Ren.make({ baseUrl: serverURL, headers: { cookie } })
  const spaceId = (await ren.space.list({ page: 1, pageSize: 25 })).items[0]?.id ?? ""
  const task = await ren.task.create({ spaceId, title: "Fix the login page" })
  const other = Session.ID.create()
  await ren.session.create({ id: other, spaceId })

  await page.goto(`/app/?spaceId=${spaceId}`)
  const start = page.getByRole("main")
  const message = start.getByRole("textbox", { name: "Message" })
  const mentions = page.getByRole("listbox", { name: "Mentions" })
  await message.pressSequentially("Read @")
  await expect(mentions.getByRole("option")).toHaveText([
    /^Tasks/,
    /^Chats/,
    /^Apps/,
    /^Agents/,
    /^Files/,
    /^Repositories/,
  ])
  await mentions.getByRole("option", { name: /^Tasks/ }).click()
  await expect(message).toHaveValue("Read @tasks:")
  await message.press("Backspace")
  await expect(message).toHaveValue("Read @")
  await message.press("ArrowRight")
  await expect(message).toHaveValue("Read @tasks:")
  await message.pressSequentially("login")
  await expect(mentions.getByRole("option")).toHaveText([`${task.identifier} Fix the login page`])
  await message.press("Enter")
  await expect(message).toHaveValue(`Read @  ${task.identifier} Fix the login page `)

  await message.pressSequentially("and @chats:")
  await mentions.getByRole("option", { name: "New chat" }).click()
  await expect(message).toHaveValue(`Read @  ${task.identifier} Fix the login page and @  New chat `)
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: 30_000 })
  const sessionId = new URL(page.url()).pathname.split("/").at(-1) ?? ""
  await expect
    .poll(async () => JSON.stringify(await ren.chat.messages({ id: sessionId })), { timeout: 30_000 })
    .toContain(`Read [${task.identifier} Fix the login page](${appURL}/tasks/${task.id}) and ${other}`)

  await page.goto(`/app/?spaceId=${spaceId}`)
  await message.pressSequentially("@")
  await expect(mentions.getByRole("group", { name: "Recent" }).getByRole("option")).toHaveText([
    "New chat",
    `${task.identifier} Fix the login page`,
  ])
})
