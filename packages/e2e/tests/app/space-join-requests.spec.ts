import { expect, test, type Browser, type Page } from "@playwright/test"
import { Schema } from "effect"
import { addMember, appOrigin, createOrganization, serverURL, uniqueEmail } from "../lib/servers.js"

async function setup(page: Page, browser: Browser) {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const created = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Cryptography", description: "Ciphers and codes" },
  })
  expect(created.ok()).toBe(true)
  const context = await browser.newContext({ baseURL: appOrigin })
  await addMember(page.request, context.request, { name: "Alan Turing", email: uniqueEmail("alan") })
  const alan = await context.newPage()
  await alan.goto("/app/spaces?tab=all")
  const spaceRow = alan.getByRole("row").filter({ hasText: "Cryptography" })
  return {
    context,
    alan,
    spaceRow,
    spaceId: Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await created.json()).id,
  }
}

test("a member asks to join a space, and a member of it approves", async ({ page, browser }) => {
  const { context, alan, spaceRow, spaceId } = await setup(page, browser)
  await spaceRow.getByRole("button", { name: "Ask to join" }).click()
  const dialog = alan.getByRole("dialog", { name: "Ask to join Cryptography" })
  await dialog.getByRole("textbox", { name: "Note" }).fill("I work on ciphers")
  await dialog.getByRole("button", { name: "Send request" }).click()
  await expect(alan.getByText("Asked to join Cryptography")).toBeVisible()
  await expect(spaceRow).toContainText("Requested")
  await expect(spaceRow.getByRole("button", { name: "Cancel" })).toBeVisible()
  const sidebar = alan.getByRole("region", { name: "Sidebar spaces" })
  await expect(sidebar.getByRole("link", { name: /Cryptography/ })).toHaveCount(0)

  await page.goto(`/app/spaces/${spaceId}/members`)
  await expect(page.getByRole("tab", { name: /Requests\s*1/ })).toBeVisible()
  await page.getByRole("tab", { name: /Requests/ }).click()
  await expect(page).toHaveURL(/members\?tab=requests/)
  const row = page.getByRole("row", { name: /Alan Turing/ })
  await expect(row).toContainText("I work on ciphers")
  await row.getByRole("button", { name: "Approve" }).click()
  await expect(page.getByText("Alan Turing added to Cryptography")).toBeVisible()
  await expect(page.getByRole("row", { name: /Alan Turing/ })).toHaveCount(0)

  await alan.reload()
  await expect(sidebar.getByRole("link", { name: "Cryptography", exact: true })).toBeVisible()
  await context.close()
})

test("a declined member can ask again", async ({ page, browser }) => {
  const { context, alan, spaceRow, spaceId } = await setup(page, browser)
  await spaceRow.getByRole("button", { name: "Ask to join" }).click()
  await alan
    .getByRole("dialog", { name: "Ask to join Cryptography" })
    .getByRole("button", { name: "Send request" })
    .click()
  await expect(spaceRow).toContainText("Requested")

  await page.goto(`/app/spaces/${spaceId}/members?tab=requests`)
  const row = page.getByRole("row", { name: /Alan Turing/ })
  await expect(row).toContainText("No note")
  await row.getByRole("button", { name: "Decline" }).click()
  await expect(page.getByText("Declined Alan Turing")).toBeVisible()
  await expect(page.getByRole("row", { name: /Alan Turing/ })).toHaveCount(0)

  await alan.reload()
  const again = alan.getByRole("row").filter({ hasText: "Cryptography" })
  await again.getByRole("button", { name: "Ask to join" }).click()
  await alan
    .getByRole("dialog", { name: "Ask to join Cryptography" })
    .getByRole("button", { name: "Send request" })
    .click()
  await expect(again).toContainText("Requested")
  await context.close()
})
