import { expect, test } from "@playwright/test"
import { addMember, appOrigin, createOrganization, uniqueEmail } from "../lib/servers.js"

test("an admin adds a key (bad, then good), turns the card off and on, and switches Anthropic to a member's subscription", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Katherine Johnson" })
  await page.goto("/settings/providers")
  const ren = page.getByLabel("Ren", { exact: true })
  await expect(ren.getByText("Free today 41 / 100")).toBeVisible()

  await page.getByRole("button", { name: "Add provider" }).click()
  const grid = page.getByRole("dialog", { name: "Add provider" })
  await grid.getByRole("textbox", { name: "Search providers" }).fill("groq")
  await expect(grid.getByRole("listitem")).toHaveCount(1)
  await grid.getByRole("button", { name: "Connect Groq" }).click()

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

  const groq = page.getByLabel("Groq", { exact: true })
  await expect(groq.getByText("…1234")).toBeVisible()
  const on = groq.getByRole("switch", { name: "Groq on" })
  await expect(on).toBeChecked()
  await on.click()
  await expect(on).not.toBeChecked()
  await page.reload()
  await expect(page.getByLabel("Groq", { exact: true }).getByRole("switch", { name: "Groq on" })).not.toBeChecked()
  await page.getByLabel("Groq", { exact: true }).getByRole("switch", { name: "Groq on" }).click()
  await expect(page.getByLabel("Groq", { exact: true }).getByRole("switch", { name: "Groq on" })).toBeChecked()

  await page.getByRole("button", { name: "Add provider" }).click()
  await page.getByRole("dialog", { name: "Add provider" }).getByRole("button", { name: "Connect Anthropic" }).click()
  const anthropicKey = page.getByRole("dialog", { name: "Connect Anthropic" })
  await anthropicKey.getByLabel("API key").fill("sk-good-5678")
  await anthropicKey.getByRole("button", { name: "Save" }).click()
  const anthropic = page.getByLabel("Anthropic", { exact: true })
  await expect(anthropic.getByText("…5678")).toBeVisible()

  await anthropic.getByRole("combobox", { name: "Anthropic method" }).click()
  await page.getByRole("option", { name: "Subscription" }).click()
  await expect(anthropic.getByText("No subscription yet. Any member can connect theirs.")).toBeVisible()
  const popup = page.waitForEvent("popup")
  await anthropic.getByRole("button", { name: "Connect your Claude" }).click()
  await expect((await popup).getByText("Signed in. You can close this tab.")).toBeVisible()
  await expect(async () => {
    await page.reload()
    await expect(page.getByLabel("Anthropic", { exact: true }).getByText("Claude subscription")).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 15_000 })
})

test("an admin switches Ren's models off and new models with them; a member reads but changes nothing", async ({
  page,
  browser,
}) => {
  await createOrganization(page.request, { name: "Dorothy Vaughan" })
  await page.goto("/settings/providers")
  await page.getByLabel("Ren", { exact: true }).getByRole("link", { name: "Models" }).click()
  const table = page.getByRole("table", { name: "Ren’s models" })
  await expect(table.getByRole("row", { name: /Stub Other/u })).toBeVisible()
  const other = table.getByRole("switch", { name: "Stub Other on" })
  await other.click()
  await expect(other).not.toBeChecked()
  await page.getByRole("tab", { name: "On" }).click()
  await expect(table.getByRole("row", { name: /Stub Other/u })).toHaveCount(0)
  await page.getByRole("tab", { name: "All" }).click()
  const newModels = page.getByRole("switch", { name: "New models on" })
  await newModels.click()
  await expect(newModels).not.toBeChecked()
  await page.reload()
  await expect(page.getByRole("switch", { name: "New models on" })).not.toBeChecked()
  await expect(page.getByRole("table", { name: "Ren’s models" }).getByRole("switch", { name: "Stub on" })).toBeChecked()

  const context = await browser.newContext({ baseURL: appOrigin })
  await addMember(page.request, context.request, { name: "Mary Jackson", email: uniqueEmail("mary") })
  const member = await context.newPage()
  await member.goto("/settings/providers")
  await expect(member.getByLabel("Ren", { exact: true }).getByRole("switch", { name: "Ren on" })).toBeDisabled()
  await expect(member.getByRole("button", { name: "Add provider" })).toHaveCount(0)
  await context.close()
})
