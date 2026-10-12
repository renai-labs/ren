import { expect, test } from "@playwright/test"
import { appURL, createUser, signIn, uniqueEmail } from "../lib/servers.js"

test("opens settings from the profile card and searches them", async ({ page }) => {
  await createUser(page.request, { name: "Ada Lovelace", email: uniqueEmail("settings"), password: "first password" })
  await page.goto("/sessions")
  await page.getByRole("button", { name: "Settings" }).click()
  await expect(page).toHaveURL(`${appURL}/sessions/settings/preferences`)
  await expect(page.getByRole("heading", { level: 1, name: "Preferences" })).toBeVisible()

  const navigation = page.getByRole("complementary", { name: "Navigation" })
  await expect(navigation.getByRole("link", { name: "Preferences" })).toHaveAttribute("aria-current", "page")
  await page.getByRole("heading", { level: 1, name: "Preferences" }).click()
  await page.keyboard.press("/")
  const search = navigation.getByRole("textbox", { name: "Search settings" })
  await expect(search).toBeFocused()
  await search.fill("nothing")
  await expect(navigation.getByText("No matching settings.")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(search).toHaveValue("")

  await navigation.getByRole("link", { name: "Back to app" }).click()
  await expect(page).toHaveURL(`${appURL}/sessions`)
})

test("renames the account and picks a theme", async ({ page }) => {
  await createUser(page.request, { name: "Ada Lovelace", email: uniqueEmail("rename"), password: "first password" })
  await page.goto("/sessions/settings/preferences")
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
  await createUser(page.request, { name: "Ada Lovelace", email, password: "first password" })
  await page.goto("/sessions/settings/preferences")
  await page.getByRole("button", { name: "Change", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Change password" })
  await expect(dialog).toContainText("Confirm your current password, then pick a new one.")
  await dialog.getByRole("button", { name: "Change password" }).click()
  await expect(dialog.getByLabel("Current password")).toHaveAccessibleDescription("Required")
  await expect(dialog.getByLabel("New password", { exact: true })).toHaveAccessibleDescription(
    "Must be at least 8 characters",
  )

  await dialog.getByLabel("Current password").fill("wrong password")
  await dialog.getByLabel("New password", { exact: true }).fill("second password")
  await dialog.getByLabel("Confirm new password").fill("second password")
  await dialog.getByRole("button", { name: "Change password" }).click()
  await expect(dialog.getByText("Invalid password")).toBeVisible()

  await dialog.getByLabel("Current password").fill("first password")
  await dialog.getByRole("button", { name: "Change password" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText("Password changed")).toBeVisible()
  expect((await signIn(request, { email, password: "second password" })).ok()).toBe(true)
})
