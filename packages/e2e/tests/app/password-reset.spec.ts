import { expect, test } from "@playwright/test"
import { createUser, emailedLink, signIn, uniqueEmail } from "../lib/servers.js"

test("a forgotten password is reset through the emailed link", async ({ page, request }) => {
  const email = uniqueEmail("reset")
  await createUser(request, { name: "Ada Lovelace", email })

  await page.goto("/app/login")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await page.getByRole("link", { name: "Forgot your password?" }).click()
  await expect(page.getByLabel("Email")).toHaveValue(email)
  await page.getByRole("button", { name: "Send reset instructions" }).click()
  await expect(page.getByText("If an account exists for")).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()

  await page.goto((await emailedLink(request, email, "reset-password?token=")).href)
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
  await page.goto("/app/reset-password?token=not-a-token")
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
