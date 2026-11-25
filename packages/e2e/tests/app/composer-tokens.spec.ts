import { expect, test } from "@playwright/test"
import { Ren } from "@ren/client"
import { Session } from "@ren/schema/session"
import { appOrigin, createOrganization, serverURL } from "../lib/servers.js"

test("the composer mentions a task and a chat as tokens through the @ categories, and the message names both", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const cookie = (await page.request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ")
  const ren = Ren.make({ baseUrl: serverURL, headers: { cookie } })
  const spaceId = (await ren.space.list({ page: 1, pageSize: 25 })).items[0]?.id ?? ""
  const task = await ren.task.create({ spaceId, title: "Fix the login page" })
  const other = Session.ID.create()
  await ren.session.create({ id: other, spaceId })

  await page.goto(`/?spaceId=${spaceId}`)
  const start = page.getByRole("main")
  const message = start.getByRole("textbox", { name: "Message" })
  const mentions = page.getByRole("listbox", { name: "Mentions" })
  const tokens = message.locator("[data-slot=token-input-token]")
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
  await expect(message).toHaveText("Read @tasks:")
  await expect(mentions.getByRole("option")).toHaveText([`${task.identifier} Fix the login page`])
  await message.pressSequentially("login")
  await expect(page.getByText("Searching…")).toBeHidden()
  await expect(mentions.getByRole("option")).toHaveText([`${task.identifier} Fix the login page`])
  await message.press("Enter")
  await expect(tokens).toHaveText([`${task.identifier} Fix the login page`])

  await message.pressSequentially("and @chats:")
  await mentions.getByRole("option", { name: "New chat" }).click()
  await expect(tokens).toHaveText([`${task.identifier} Fix the login page`, "New chat"])
  await page.screenshot({ path: "test-results/composer-tokens.png" })
  await start.getByRole("button", { name: "Send", exact: true }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: 30_000 })
  const sessionId = new URL(page.url()).pathname.split("/").at(-1) ?? ""
  await expect
    .poll(async () => JSON.stringify(await ren.chat.messages({ id: sessionId })), { timeout: 30_000 })
    .toContain(`Read [${task.identifier} Fix the login page](${appOrigin}/tasks/${task.id}) and ${other}`)

  await page.goto(`/?spaceId=${spaceId}`)
  await message.pressSequentially("@")
  await expect(mentions.getByRole("group", { name: "Recent" }).getByRole("option")).toHaveText([
    "New chat",
    `${task.identifier} Fix the login page`,
  ])
  await message.press("Enter")
  await expect(tokens).toHaveText(["New chat"])
  await message.press("Backspace")
  await message.press("Backspace")
  await expect(tokens).toHaveCount(0)
  await expect(message).toHaveText("")
})

test("an app mention is a token that survives a reload, undoes in one step and sends as the app's chip", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const cookie = (await page.request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ")
  const ren = Ren.make({ baseUrl: serverURL, headers: { cookie } })
  const zeta = await ren["app-registry"].get({ idOrSlug: "zz-notes" })
  await ren["app-profile"].create({ appId: zeta.id, name: "Mine", slug: "zz-notes", kind: "private" })

  await page.goto("/")
  const start = page.getByRole("main")
  const message = start.getByRole("textbox", { name: "Message" })
  const mentions = page.getByRole("listbox", { name: "Mentions" })
  const tokens = message.locator("[data-slot=token-input-token]")
  await message.pressSequentially("Write the notes on @zeta")
  await expect(page.getByText("Searching…")).toBeHidden()
  await mentions.getByRole("option", { name: /Zeta Notes/ }).click()
  await expect(tokens).toHaveText([/Zeta Notes$/])
  await message.press("ControlOrMeta+z")
  await expect(tokens).toHaveCount(0)
  await expect(message).toHaveText("Write the notes on @zeta")
  await message.press("ControlOrMeta+Shift+z")
  await expect(tokens).toHaveText([/Zeta Notes$/])
  await message.pressSequentially(".")

  await expect.poll(() => page.evaluate(() => JSON.stringify(localStorage)), { timeout: 5_000 }).toContain("Zeta Notes")
  await page.reload()
  await expect(tokens).toHaveText([/Zeta Notes$/])
  await start.getByRole("button", { name: "Send", exact: true }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: 30_000 })
  await expect(page.locator("[data-chip]").filter({ has: page.getByText("Zeta Notes") })).toHaveCount(1)
})
