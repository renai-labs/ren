import { expect, test } from "@playwright/test"
import { createOrganization, createUser, password, signIn, uniqueEmail } from "../lib/servers.js"

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

test("the timeline width sets the chat column and leaves the home composer alone", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const start = page.getByRole("form", { name: "Start a chat" })
  const homeWidth = (await start.boundingBox())?.width
  await start.getByRole("textbox", { name: "Message" }).fill("Plan the launch")
  await start.getByRole("button", { name: "Send" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: 30_000 })
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: 30_000 })
  const chatURL = page.url()
  const column = page.locator("[data-slot=message-scroller-content]")
  const width = async () => (await column.boundingBox())?.width ?? 0

  await page.goto("/app/settings/preferences")
  await page.getByRole("combobox", { name: "Timeline width" }).click()
  await page.getByRole("option", { name: "Focused" }).click()
  await page.goto(chatURL)
  await expect.poll(width).toBeLessThanOrEqual(488)

  await page.goto("/app/settings/preferences")
  await page.getByRole("combobox", { name: "Timeline width" }).click()
  await page.getByRole("option", { name: "Wide" }).click()
  await page.goto(chatURL)
  await expect.poll(width).toBeGreaterThan(768)
  expect(await width()).toBeLessThanOrEqual(1000)

  await page.goto("/app/")
  expect((await page.getByRole("form", { name: "Start a chat" }).boundingBox())?.width).toBe(homeWidth)
})
