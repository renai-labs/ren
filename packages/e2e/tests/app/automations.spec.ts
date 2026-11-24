import { expect, test } from "@playwright/test"
import type { Page as Browser } from "@playwright/test"
import { Schema } from "effect"
import { createOrganization, serverURL } from "../lib/servers.js"

const brainStart = 30_000

const Page = <Item extends Schema.Top>(item: Item) => Schema.Struct({ items: Schema.Array(item) })

test.describe.configure({ timeout: 90_000 })

const addTrigger = async (page: Browser, choice: { readonly schedule: string } | "webhook") => {
  await page.getByRole("button", { name: "Add trigger" }).click()
  if (choice === "webhook") return page.getByRole("menuitem", { name: "Webhook", exact: true }).click()
  await page.getByRole("menuitem", { name: "Schedule", exact: true }).hover()
  return page.getByRole("menuitem", { name: choice.schedule, exact: true }).click()
}

test("a member creates a daily automation, tests it, opens the run beside its history, and does not find it in the chat list", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/automations")
  await expect(page.getByText("No schedules yet")).toBeVisible()

  await page.getByRole("link", { name: "New automation" }).first().click()
  await page.getByRole("textbox", { name: "Name" }).fill("Daily report")
  await addTrigger(page, { schedule: "Daily" })
  await expect(page.getByText("Every day at")).toBeVisible()
  await page.getByRole("textbox", { name: "Agent instructions" }).fill("Summarize the day")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page).toHaveURL(/\/automations\/spc_\w+\/daily-report$/u)

  await page.getByRole("button", { name: "Test" }).click()
  await expect(page.getByText("Test run started")).toBeVisible()
  await page.getByRole("button", { name: "Run history" }).click()
  await expect(page.getByRole("cell", { name: "Test run" })).toBeVisible({ timeout: brainStart })
  await page.getByRole("button", { name: "Open chat" }).click()
  await expect(page).toHaveURL(/[?&]session=ses_\w+/u)
  const run = page.getByRole("dialog", { name: "Automation run" })
  await expect(run.getByText("Summarize the day")).toBeVisible({ timeout: brainStart })
  await expect(run.getByText("stub reply")).toBeVisible({ timeout: brainStart })
  await page.keyboard.press("Escape")
  await expect(run).toHaveCount(0)

  await page.goto("/automations")
  await expect(page.getByRole("navigation").getByText("Summarize the day")).toHaveCount(0)
  await expect(page.getByRole("cell", { name: /every day/u })).toBeVisible()
  await expect(page.getByRole("cell", { name: /Active/u })).toBeVisible()
  await page.getByRole("tab", { name: /^Webhooks/u }).click()
  await expect(page.getByText("No webhooks yet")).toBeVisible()
})

const signup = (email: string) => ({ event: { event: "user signed up", uuid: crypto.randomUUID() }, person: { email } })

test("a member creates a webhook automation that is off, sees its first request recorded, turns it on, and the next request starts a chat", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const spaces = Schema.decodeUnknownSync(Page(Schema.Struct({ id: Schema.String })))(
    await (await page.request.get(`${serverURL}/spaces?page=1&pageSize=50`)).json(),
  )
  const spaceId = spaces.items.at(0)?.id ?? ""
  await page.goto(`/spaces/${spaceId}/automations?kind=webhooks`)
  await expect(page.getByText("No webhooks yet")).toBeVisible()

  await page.getByRole("link", { name: "New automation" }).first().click()
  await page.getByRole("textbox", { name: "Name" }).fill("Signups")
  await page.getByRole("switch", { name: "Active" }).click()
  await addTrigger(page, "webhook")
  await page.getByRole("textbox", { name: "Agent instructions" }).fill("Greet this person.")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId}/automations/signups$`, "u"))

  const webhooks = Schema.decodeUnknownSync(Page(Schema.Struct({ url: Schema.String })))(
    await (await page.request.get(`${serverURL}/webhooks?spaceId=${spaceId}&page=1&pageSize=50`)).json(),
  )
  const url = new URL(webhooks.items.at(0)?.url ?? "")
  const send = (body: unknown) => page.request.post(`${serverURL}${url.pathname}`, { data: body })
  expect((await send(signup("first@acme.com"))).status()).toBe(202)
  await page.getByRole("button", { name: "Run history" }).click()
  await expect(page.getByRole("cell", { name: "Recorded" })).toBeVisible({ timeout: 10_000 })

  await page.getByRole("link", { name: "Signups" }).click()
  await page.getByRole("switch", { name: "Active" }).click()
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByRole("switch", { name: "Active" })).toBeChecked()
  await page.getByRole("button", { name: "Run history" }).click()
  expect((await send(signup("second@acme.com"))).status()).toBe(202)
  await expect(page.getByRole("cell", { name: "Started" })).toBeVisible({ timeout: brainStart })
  await page.getByRole("button", { name: "Open chat" }).click()
  const run = page.getByRole("dialog", { name: "Automation run" })
  await expect(run.getByText("Greet this person.")).toBeVisible({ timeout: brainStart })
  await expect(run.getByText("stub reply")).toBeVisible({ timeout: brainStart })
})
