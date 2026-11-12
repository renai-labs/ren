import { expect, test } from "@playwright/test"
import { createUser, password, signIn, uniqueEmail } from "../lib/servers.js"

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

test("sets the code font and interface size, then resets them", async ({ page }) => {
  await createUser(page.request, { name: "Ada Lovelace", email: uniqueEmail("typography") })
  await page.goto("/app/settings/preferences")
  const code = page.locator("[data-slot=code-block-content]").first()
  await expect(code).not.toHaveCSS("font-family", /Courier New/)

  await page.getByRole("textbox", { name: "Code font" }).fill("Courier New")
  await expect(code).toHaveCSS("font-family", /Courier New/)
  await page.getByRole("combobox", { name: "Interface size" }).click()
  await page.getByRole("option", { name: "Large", exact: true }).click()
  await expect(page.locator("html")).toHaveCSS("font-size", "17px")

  await page.reload()
  await expect(page.locator("html")).toHaveCSS("font-size", "17px")
  await expect(page.locator("html")).toHaveCSS("--user-font-mono", /Courier New/)

  await page.getByRole("button", { name: "Reset to defaults" }).click()
  await expect(page.locator("html")).toHaveCSS("font-size", "16px")
  await expect(page.getByRole("textbox", { name: "Code font" })).toHaveValue("")
  await expect(code).not.toHaveCSS("font-family", /Courier New/)
})
