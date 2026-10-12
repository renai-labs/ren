import { expect, test } from "@playwright/test"
import { emailedCode, uniqueEmail } from "../lib/servers.js"

test("a new account is created and verified with the emailed code", async ({ page, request }) => {
  const email = uniqueEmail("signup")
  await page.goto("/signup")
  await expect(page.getByText("By creating an account, you agree to the")).toBeVisible()
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByText("Enter your name")).toBeVisible()
  await expect(page.getByText("Enter a valid email")).toBeVisible()

  await page.getByLabel("Name").fill("Ada Lovelace")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByLabel("Email")).toHaveValue(email)
  await expect(page.getByLabel("Password", { exact: true })).toHaveAccessibleDescription("At least 8 characters")
  await page.getByLabel("Password", { exact: true }).fill("short")
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByText("Password must be at least 8 characters")).toBeVisible()
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery")
  await page.getByRole("button", { name: "Continue", exact: true }).click()

  await expect(page).toHaveURL(/\/verify-email\?email=/)
  await expect(page.getByText("Enter the code sent to")).toBeVisible()
  await expect(page.getByText(/Resend in 0:\d\d/)).toBeVisible()
  const slots = page.getByRole("textbox")
  await slots.first().click()
  await page.keyboard.type("000000")
  await expect(page.getByText("That code didn’t work. Check it and try again.")).toBeVisible()
  await expect(slots.first()).toHaveAccessibleDescription("That code didn’t work. Check it and try again.")

  await slots.first().click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.press("Backspace")
  await page.keyboard.type(await emailedCode(request, email))
  await expect(page).toHaveURL(/\/sessions$/)
  await expect(page.getByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeVisible()

  await page.goto("/signup")
  await expect(page).toHaveURL(/\/sessions$/)
})

test("a rejected address returns to the details step with the server’s reason", async ({ page }) => {
  await page.goto("/signup")
  await page.getByLabel("Name").fill("Ada Lovelace")
  await page.getByLabel("Email").fill(`ada-${crypto.randomUUID()}@mailinator.com`)
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery")
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByLabel("Email")).toHaveAccessibleDescription("Please use a permanent email address.")
  await expect(page.getByLabel("Email")).toBeFocused()
  await expect(page.getByLabel("Name")).toHaveValue("Ada Lovelace")
})

test("verify email without an address goes back to sign in", async ({ page }) => {
  await page.goto("/verify-email?redirect=%2Fsettings")
  await expect(page).toHaveURL(/\/login\?redirect=%2Fsettings$/)
  await page.goto("/signup")
  await page.getByRole("link", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/login$/)
})
