import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { createOrganization, serverURL } from "../lib/servers.js"

const brainStart = 30_000

const Page = <Item extends Schema.Top>(item: Item) => Schema.Struct({ items: Schema.Array(item) })

test.describe.configure({ timeout: 90_000 })

const signup = (email: string) => ({ event: { event: "user signed up", uuid: crypto.randomUUID() }, person: { email } })

test("a member creates a webhook with the form, sees its first request recorded, turns it on, and the next request starts a chat", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const spaces = Schema.decodeUnknownSync(Page(Schema.Struct({ id: Schema.String })))(
    await (await page.request.get(`${serverURL}/spaces?page=1&pageSize=50`)).json(),
  )
  const spaceId = spaces.items.at(0)?.id ?? ""
  await page.goto(`/app/spaces/${spaceId}/webhooks`)
  await expect(page.getByText("No webhooks yet")).toBeVisible()

  await page.getByRole("button", { name: "Create webhook" }).click()
  const sheet = page.getByRole("dialog", { name: "Create webhook" })
  await sheet.getByRole("textbox", { name: "Name" }).fill("Signups")
  await sheet.getByRole("textbox", { name: "Message" }).fill("Greet this person.")
  await sheet.getByRole("button", { name: "Create webhook" }).click()
  await expect(page.getByRole("heading", { name: "Signups" })).toBeVisible()

  const webhooks = Schema.decodeUnknownSync(Page(Schema.Struct({ url: Schema.String })))(
    await (await page.request.get(`${serverURL}/webhooks?spaceId=${spaceId}&page=1&pageSize=50`)).json(),
  )
  const url = new URL(webhooks.items.at(0)?.url ?? "")
  const send = (body: unknown) => page.request.post(`${serverURL}${url.pathname}`, { data: body })
  expect((await send(signup("first@acme.com"))).status()).toBe(202)
  await page.getByRole("tab", { name: /Deliveries/u }).click()
  await expect(page.getByRole("cell", { name: "Recorded" })).toBeVisible({ timeout: 10_000 })

  await page.getByRole("switch", { name: "Start chats from Signups" }).click()
  await expect(page.getByRole("switch", { name: "Start chats from Signups" })).toBeChecked()
  expect((await send(signup("second@acme.com"))).status()).toBe(202)
  await expect(page.getByRole("cell", { name: "Started" })).toBeVisible({ timeout: brainStart })
  await page.getByRole("link", { name: "Open chat" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/u)
  await expect(page.getByText("Greet this person.")).toBeVisible({ timeout: brainStart })
  await expect(page.getByRole("link", { name: "View request" })).toBeVisible()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
})
