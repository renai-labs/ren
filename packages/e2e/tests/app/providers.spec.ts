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
  await expect(connect.getByText("Enter api key.")).toBeVisible()
  await connect.getByLabel("API key").fill("sk-bad-0000")
  await connect.getByRole("button", { name: "Save" }).click()
  await expect(connect.getByText("Invalid API key.")).toBeVisible()
  await connect.getByLabel("API key").fill("sk-good-1234")
  await connect.getByRole("button", { name: "Test connection" }).click()
  await expect(connect.getByText("Connection works")).toBeVisible()
  await connect.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Groq connected")).toBeVisible()
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
