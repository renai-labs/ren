import { expect, test } from "@playwright/test"
import { addMember, appOrigin, createOrganization, uniqueEmail } from "../lib/servers.js"

test("an admin connects a key from the grid (bad, then good) and turns the provider off and on", async ({ page }) => {
  await createOrganization(page.request, { name: "Katherine Johnson" })
  await page.goto("/settings/providers")
  const grid = page.getByRole("list", { name: "Providers" })
  await expect(grid.getByRole("listitem", { name: "Ren" })).toContainText("Built in")

  await page.getByRole("textbox", { name: "Search providers" }).fill("groq")
  await expect(grid.getByRole("listitem")).toHaveCount(1)
  const card = grid.getByRole("listitem", { name: "Groq" })
  await expect(card.getByText("1 model")).toBeVisible()
  await card.getByRole("button", { name: "Connect Groq" }).click()

  const connect = page.getByRole("dialog", { name: "Connect Groq" })
  await connect.getByRole("button", { name: "Save" }).click()
  await expect(connect.getByText("API key is required.")).toBeVisible()
  await connect.getByLabel("API key").fill("sk-bad-0000")
  await connect.getByRole("button", { name: "Save" }).click()
  await expect(connect.getByText("Invalid API key.")).toBeVisible()
  await connect.getByLabel("API key").fill("sk-good-1234")
  await connect.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Groq key saved")).toBeVisible()
  await expect(card.getByText("On", { exact: true })).toBeVisible()
  await expect(card.getByText("…1234")).toBeVisible()

  await card.getByRole("link", { name: "Groq" }).click()
  await expect(page.getByRole("heading", { name: "Groq" })).toBeVisible()
  await expect(page.getByRole("region", { name: "API key" }).getByText("…1234")).toBeVisible()
  const on = page.getByRole("switch", { name: "Groq on" })
  await expect(on).toBeChecked()
  await on.click()
  await expect(on).not.toBeChecked()
  await page.reload()
  await expect(page.getByRole("switch", { name: "Groq on" })).not.toBeChecked()
  await page.getByRole("switch", { name: "Groq on" }).click()
  await expect(page.getByRole("switch", { name: "Groq on" })).toBeChecked()
})

test("an admin switches a Ren model off on Ren's page; a member reads but changes nothing", async ({
  page,
  browser,
}) => {
  await createOrganization(page.request, { name: "Dorothy Vaughan" })
  await page.goto("/settings/providers")
  await page.getByRole("list", { name: "Providers" }).getByRole("link", { name: "Ren" }).click()
  await expect(page.getByRole("heading", { name: "Ren" })).toBeVisible()
  const table = page.getByRole("table", { name: "Models" })
  await expect(table.getByRole("row", { name: /Stub Other/u })).toBeVisible()
  const other = table.getByRole("switch", { name: "Stub Other on" })
  await other.click()
  await expect(other).not.toBeChecked()
  await page.getByRole("tab", { name: "On" }).click()
  await expect(table.getByRole("row", { name: /Stub Other/u })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole("table", { name: "Models" }).getByRole("switch", { name: "Stub on" })).toBeChecked()
  await expect(
    page.getByRole("table", { name: "Models" }).getByRole("switch", { name: "Stub Other on" }),
  ).not.toBeChecked()

  const context = await browser.newContext({ baseURL: appOrigin })
  await addMember(page.request, context.request, { name: "Mary Jackson", email: uniqueEmail("mary") })
  const member = await context.newPage()
  await member.goto("/settings/providers")
  await expect(member.getByRole("button", { name: /^Connect / })).toHaveCount(0)
  await member.getByRole("list", { name: "Providers" }).getByRole("link", { name: "Ren" }).click()
  await expect(member.getByRole("switch", { name: "Ren on" })).toBeDisabled()
  await context.close()
})

test("the owner connects their Claude subscription from the grid; chats then use it and the table names the plan", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Mary Jackson" })
  await page.goto("/settings/providers")
  const card = page.getByRole("list", { name: "Providers" }).getByRole("listitem", { name: "Anthropic" })
  await card.getByRole("button", { name: "Connect Anthropic" }).click()

  const connect = page.getByRole("dialog", { name: "Connect Anthropic" })
  await expect(connect.getByRole("tab", { name: "Subscription", selected: true })).toBeVisible()
  await expect(connect.getByRole("textbox", { name: "2. Paste it here" })).toBeDisabled()
  const opened = page.context().waitForEvent("page")
  await connect.getByRole("button", { name: "Connect your Claude" }).click()
  await (await opened).close()
  await expect(connect.getByText("Paste the code Claude shows after you sign in.")).toBeVisible()
  await connect.getByRole("textbox", { name: "2. Paste it here" }).fill("wrong-code")
  await connect.getByRole("button", { name: "Connect subscription" }).click()
  await expect(connect.getByText("That code is not valid. Sign in again.")).toBeVisible()
  await connect.getByRole("textbox", { name: "2. Paste it here" }).fill("good-code")
  await connect.getByRole("button", { name: "Connect subscription" }).click()
  await expect(page.getByText("Anthropic subscription connected")).toBeVisible()

  await card.getByRole("link", { name: "Anthropic" }).click()
  const chatsUse = page.getByRole("group", { name: "Chats use" })
  await expect(chatsUse.getByRole("radio", { name: /Subscriptions/u })).toBeChecked()
  await expect(chatsUse.getByText("1 connected")).toBeVisible()
  await expect(chatsUse.getByRole("radio", { name: /API key/u })).toBeDisabled()
  await expect(page.getByRole("heading", { name: "Models your subscriptions serve (2)" })).toBeVisible()
  await expect(
    page.getByRole("table", { name: "Models" }).getByRole("row", { name: /Claude Opus 5.5/u }),
  ).toContainText("Max")

  await page.goto("/")
  await expect(async () => {
    await page.reload()
    await page.getByRole("button", { name: /^Choose model/u }).click()
    await expect(page.getByRole("heading", { name: /^Anthropic \(subscription\)/u })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 45_000 })
  await expect(page.getByRole("button", { name: /^Claude Opus 5.5/u })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Claude Haiku 5.5/u })).toHaveCount(0)
  await page.getByRole("button", { name: "More models (1)" }).click()
  await expect(page.getByRole("button", { name: /^Claude Haiku 5.5/u })).toBeVisible()
})
