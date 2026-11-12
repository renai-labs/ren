import { expect, test } from "@playwright/test"
import { Session } from "@ren/schema/session"
import { Schema } from "effect"
import { appOrigin, createOrganization, createUser, password, serverURL, signIn, uniqueEmail } from "../lib/servers.js"

test("renames the account and picks a theme", async ({ page }) => {
  await createUser(page.request, { name: "Ada Lovelace", email: uniqueEmail("rename") })
  await page.goto("/app/settings/preferences")
  await expect(page.getByText("Contact support to change.")).toBeVisible()
  await page.getByRole("button", { name: "Edit Name" }).click()
  await page.getByRole("textbox", { name: "Name" }).fill("Ada King")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "Edit Name" })).toHaveText("Ada King")

  await page.getByRole("radio", { name: "Light" }).click()
  await expect(page.locator("html")).toHaveClass(/light/)
  await page.reload()
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked()

  await page.getByRole("link", { name: "Back to app" }).click()
  await expect(page.getByRole("combobox", { name: /Switch organization/ })).toContainText("Ada King")
})

test("changes the password", async ({ page, request }) => {
  const email = uniqueEmail("password")
  await createUser(page.request, { name: "Ada Lovelace", email })
  await page.goto("/app/settings/preferences")
  await page.getByRole("button", { name: "Change", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Change password" })
  await expect(dialog).toContainText("Confirm your current password, then pick a new one.")

  await dialog.getByLabel("Current password").fill("wrong password")
  await dialog.getByLabel("New password", { exact: true }).fill("second password")
  await dialog.getByLabel("Confirm new password").fill("second password")
  await dialog.getByRole("button", { name: "Change password" }).click()
  await expect(dialog.getByText("Invalid password")).toBeVisible()

  await dialog.getByLabel("Current password").fill(password)
  await dialog.getByRole("button", { name: "Change password" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText("Password changed")).toBeVisible()
  expect((await signIn(request, { email, password: "second password" })).ok()).toBe(true)
})

test("a preference changed in one tab applies in the other open tabs without a reload", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  const listed = await page.request.get(`${serverURL}/spaces?page=1&pageSize=25`)
  const spaces = Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) }))(
    await listed.json(),
  )
  const sessionId = Session.ID.create()
  const created = await page.request.post(`${serverURL}/sessions`, {
    headers: { origin: appOrigin },
    data: { id: sessionId, spaceId: spaces.items[0]?.id },
  })
  expect(created.ok()).toBe(true)

  const chat = await page.context().newPage()
  await chat.goto(`/app/sessions/${sessionId}`)
  await expect(chat.getByRole("textbox", { name: "Message", exact: true })).toBeVisible()
  const other = await page.context().newPage()
  await other.goto("/app/settings/preferences")
  await page.goto("/app/settings/preferences")
  await expect(other.getByRole("combobox", { name: "Detail" })).toHaveText("Compact")

  await page.getByRole("combobox", { name: "Detail" }).click()
  await page.getByRole("option", { name: "Detailed" }).click()
  await expect(page.getByRole("combobox", { name: "Detail" })).toHaveText("Detailed")
  await expect(other.getByRole("combobox", { name: "Detail" })).toHaveText("Detailed")

  await page.getByRole("radio", { name: "Light" }).click()
  await expect(chat.locator("html")).not.toHaveClass(/dark/)
  await expect(other.getByRole("radio", { name: "Light" })).toBeChecked()
})
