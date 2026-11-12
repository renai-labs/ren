import { expect, test } from "@playwright/test"
import { Session } from "@ren/schema/session"
import { Schema } from "effect"
import { appOrigin, createOrganization, serverURL } from "../lib/servers.js"
import { ports } from "../lib/env.js"

const brainStart = 30_000

test.describe.configure({ timeout: 120_000 })

test("a PR link in a finished reply shows its state icon and a hover card; a link outside the space stays plain", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const me = Schema.decodeUnknownSync(
    Schema.Struct({ organization: Schema.Struct({ id: Schema.String }), user: Schema.Struct({ id: Schema.String }) }),
  )(await (await page.request.get(`${serverURL}/me`)).json())
  const listed = Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) }))(
    await (await page.request.get(`${serverURL}/spaces?page=1&pageSize=25`)).json(),
  )
  const spaceId = listed.items[0]?.id ?? ""
  const repository = `acme/web-${crypto.randomUUID().slice(0, 8)}`
  const mailbox = `http://127.0.0.1:${ports.mailbox}`
  const installed = await page.request.post(`${mailbox}/github`, {
    data: {
      organizationId: me.organization.id,
      userId: me.user.id,
      spaceId,
      repository,
      number: 7,
      title: "Fix the queue ordering",
    },
  })
  expect(installed.ok()).toBe(true)
  const pull = `https://github.com/${repository}/pull/7`
  const outside = "https://github.com/acme/elsewhere/pull/9"
  const scripted = await page.request.post(`${mailbox}/reply`, { data: { reply: `Opened ${pull} and ${outside}` } })
  const marker = Schema.decodeUnknownSync(Schema.Struct({ marker: Schema.String }))(await scripted.json()).marker

  const sessionId = Session.ID.create()
  const created = await page.request.post(`${serverURL}/sessions`, {
    headers: { origin: appOrigin },
    data: { id: sessionId, spaceId },
  })
  expect(created.ok()).toBe(true)
  await page.goto(`/app/sessions/${sessionId}`)
  const message = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await message.fill(`Open the PR ${marker}`)
  await message.press("Enter")

  const link = page.getByRole("link", { name: `${repository}#7` })
  await expect(link).toBeVisible({ timeout: brainStart })
  await link.hover()
  const card = page.locator("[data-slot=hover-card-content]")
  await expect(card).toContainText("Fix the queue ordering")
  await expect(card).toContainText("Open")
  await expect(card.getByRole("link", { name: "Open in GitHub" })).toBeVisible()
  await expect(page.getByRole("link", { name: outside })).toBeVisible()
})
