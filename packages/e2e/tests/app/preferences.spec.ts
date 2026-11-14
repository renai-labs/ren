import { expect, test } from "@playwright/test"
import { Session } from "@ren/schema/session"
import { Schema } from "effect"
import { appOrigin, createOrganization, createUser, password, serverURL, signIn, uniqueEmail } from "../lib/servers.js"

test("renames the account and picks a theme", async ({ page }) => {
  await createUser(page.request, { name: "Ada Lovelace", email: uniqueEmail("rename") })
  await page.goto("/settings/preferences")
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
  await page.goto("/settings/preferences")
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

test("the timeline width sets the chat column and leaves the home composer alone", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/")
  const start = page.locator("[data-slot=input-group]").filter({ has: page.getByRole("textbox", { name: "Message" }) })
  const homeWidth = (await start.boundingBox())?.width
  await start.getByRole("textbox", { name: "Message" }).fill("Plan the launch")
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: 30_000 })
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: 30_000 })
  const chatURL = page.url()
  const column = page.locator("[data-slot=message-scroller-content]")
  const width = async () => (await column.boundingBox())?.width ?? 0

  await expect.poll(width).toBeGreaterThan(0)
  expect(await width()).toBeLessThanOrEqual(768)

  await page.goto("/settings/preferences")
  await page.getByRole("combobox", { name: "Timeline width" }).click()
  await page.getByRole("option", { name: "Wide" }).click()
  await page.goto(chatURL)
  await expect.poll(width).toBeGreaterThan(768)
  expect(await width()).toBeLessThanOrEqual(1000)

  await page.goto("/settings/preferences")
  await page.getByRole("combobox", { name: "Timeline width" }).click()
  await page.getByRole("option", { name: "Comfortable" }).click()
  await page.goto(chatURL)
  await expect.poll(width).toBeLessThanOrEqual(768)

  await page.goto("/")
  expect((await start.boundingBox())?.width).toBe(homeWidth)
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
  await chat.goto(`/sessions/${sessionId}`)
  await expect(chat.getByRole("textbox", { name: "Message", exact: true })).toBeVisible()
  const other = await page.context().newPage()
  await other.goto("/settings/preferences")
  await page.goto("/settings/preferences")
  await expect(other.getByRole("combobox", { name: "Timeline width" })).toHaveText("Comfortable")

  await page.getByRole("combobox", { name: "Timeline width" }).click()
  await page.getByRole("option", { name: "Wide" }).click()
  await expect(page.getByRole("combobox", { name: "Timeline width" })).toHaveText("Wide")
  await expect(other.getByRole("combobox", { name: "Timeline width" })).toHaveText("Wide")
  await expect(chat.locator("html")).toHaveAttribute("data-timeline-width", "wide")

  await page.getByRole("radio", { name: "Light" }).click()
  await expect(chat.locator("html")).not.toHaveClass(/dark/)
  await expect(other.getByRole("radio", { name: "Light" })).toBeChecked()
})

test("picks the code font and interface size, then resets every preference", async ({ page }) => {
  await createUser(page.request, { name: "Ada Lovelace", email: uniqueEmail("typography") })
  await page.goto("/settings/preferences")
  const reset = page.getByRole("button", { name: "Reset to defaults" })
  await expect(reset).toBeDisabled()

  await page.getByRole("combobox", { name: "Code font" }).click()
  await page.getByRole("option", { name: "JetBrains Mono" }).click()
  await expect(page.locator("html")).toHaveCSS("--user-font-mono", /JetBrains Mono/)
  await page.getByRole("combobox", { name: "Interface size" }).click()
  await page.getByRole("option", { name: "Large", exact: true }).click()
  await expect(page.locator("html")).toHaveCSS("font-size", "17px")
  await page.getByRole("radio", { name: "Light" }).click()

  await page.reload()
  await expect(page.locator("html")).toHaveCSS("font-size", "17px")
  await expect(page.locator("html")).toHaveCSS("--user-font-mono", /JetBrains Mono/)

  await reset.click()
  await expect(page.locator("html")).toHaveCSS("font-size", "16px")
  await expect(page.locator("html")).not.toHaveCSS("--user-font-mono", /JetBrains Mono/)
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked()
  await expect(reset).toBeDisabled()

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.locator("html")).toHaveCSS("font-size", "17px")
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked()
})
