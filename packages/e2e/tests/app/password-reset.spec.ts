import { expect, test } from "@playwright/test"
import { createUser, lastEmail, signIn, uniqueEmail } from "../lib/servers.js"

test("a forgotten password is reset through the emailed link", async ({ page, request }) => {
  const email = uniqueEmail("reset")
  await createUser(request, { name: "Ada Lovelace", email, password: "first password" })

  await page.goto(`/forgot-password?email=${encodeURIComponent(email)}`)
  await expect(page.getByLabel("Email")).toHaveValue(email)
  await page.getByRole("button", { name: "Send reset instructions" }).click()
  await expect(page.getByText("If an account exists for")).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()

  const link = /(http\S+reset-password\?token=\S+)/.exec(await lastEmail(request, email, "reset-password"))?.[1]
  expect(link).toBeDefined()
  await page.goto(link ?? "")
  await page.getByLabel("New password", { exact: true }).fill("second password")
  await page.getByLabel("Confirm new password").fill("other password")
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByText("Passwords do not match")).toBeVisible()
  await page.getByLabel("Confirm new password").fill("second password")
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)

  expect((await signIn(request, { email, password: "second password" })).ok()).toBe(true)
})

test("a used or missing reset link offers a new one", async ({ page }) => {
  await page.goto("/reset-password?token=not-a-token")
  await page.getByLabel("New password", { exact: true }).fill("second password")
  await page.getByLabel("Confirm new password").fill("second password")
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(
    page.getByText("This reset link has expired or was already used. Request a new one to continue."),
  ).toBeVisible()
  await page.getByRole("link", { name: "Request a new link" }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Ren" })).toBeVisible()
})

test("the forgot password form validates the email before sending", async ({ page }) => {
  await page.goto("/forgot-password")
  await page.getByLabel("Email").fill("not an email")
  await page.getByRole("button", { name: "Send reset instructions" }).click()
  await expect(page.getByText("Enter a valid email")).toBeVisible()
  await page.getByRole("link", { name: "Back to sign in" }).click()
  await expect(page).toHaveURL(/\/login$/)
})
