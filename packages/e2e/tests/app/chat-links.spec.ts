import { expect, test, type Page } from "@playwright/test"
import { Session } from "@ren/schema/session"
import { Schema } from "effect"
import { addMember, appOrigin, appURL, createOrganization, serverURL, uniqueEmail } from "../lib/servers.js"
import { ports } from "../lib/env.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

const reply = async (page: Page, text: string) => {
  const scripted = await page.request.post(`http://127.0.0.1:${ports.mailbox}/script`, { data: { reply: text } })
  return Schema.decodeUnknownSync(Schema.Struct({ marker: Schema.String }))(await scripted.json()).marker
}

const startChat = async (page: Page, text: string, spaceId?: string) => {
  await page.goto(spaceId ? `/app/?spaceId=${spaceId}` : "/app/")
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill(text)
  await message.press("Enter")
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
}

test("a chat link shows the chat's title and opens in place, and a member outside the space sees the plain link", async ({
  page,
  browser,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const listed = await page.request.get(`${serverURL}/spaces?page=1&pageSize=25`)
  const spaces = Schema.decodeUnknownSync(
    Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) }),
  )(await listed.json())
  const personal = spaces.items.find((space) => space.name.endsWith("Personal Space"))?.id
  await startChat(page, "Name this chat", personal)
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
  const other = new URL(page.url()).pathname.split("/").at(-1) ?? ""
  expect(Schema.is(Session.ID)(other)).toBe(true)

  const marker = await reply(page, `Continuing from ${appURL}/sessions/${other} and ${other}.`)
  await startChat(page, `Link the other chat ${marker}`, personal)
  const chips = page.locator("[data-slot=chat-mention]")
  await expect(chips).toHaveCount(2, { timeout: brainStart })
  await expect(chips.first()).toHaveText("Stub title")
  await expect(chips.first()).toHaveAttribute("href", `${appURL}/sessions/${other}`)
  await chips.first().click()
  await expect(page).toHaveURL(`${appURL}/sessions/${other}`)
  expect(page.context().pages()).toHaveLength(1)

  const member = await browser.newContext({ baseURL: appOrigin })
  await addMember(page.request, member.request, { name: "Alan Turing", email: uniqueEmail("alan") })
  const alan = await member.newPage()
  const hidden = await reply(alan, `I picked up from ${appURL}/sessions/${other} and ${other}.`)
  await startChat(alan, `Link the other chat ${hidden}`)
  await expect(alan.getByText("I picked up from")).toBeVisible({ timeout: brainStart })
  await expect(alan.getByRole("link", { name: `${appURL}/sessions/${other}` })).toBeVisible()
  await expect(alan.locator("[data-slot=chat-mention]")).toHaveCount(0)
  await alan.getByRole("link", { name: `${appURL}/sessions/${other}` }).hover()
  await expect(alan.getByText("Chat not found or not shared with you")).toBeVisible()
  await member.close()
})
