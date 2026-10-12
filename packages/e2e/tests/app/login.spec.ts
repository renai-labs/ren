import { expect, test } from "@playwright/test"
import { appURL, createUser, emailedCode, uniqueEmail } from "../lib/servers.js"

test("signs in with a password and returns to the requested page", async ({ page, request }) => {
  const email = uniqueEmail("login")
  await createUser(request, { name: "Ada Lovelace", email, password: "correct horse battery" })

  await page.goto("/")
  await expect(page).toHaveURL(/\/login\?redirect=%2F$/)
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByLabel("Email")).toHaveValue(email)
  await page.getByLabel("Password", { exact: true }).fill("wrong password")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password.")
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(`${appURL}/`)
  await expect(page.getByText("Ada Lovelace")).toBeVisible()

  await page.goto("/login")
  await expect(page).toHaveURL(`${appURL}/`)
})

test("signs in with an emailed code", async ({ page, request }) => {
  const email = uniqueEmail("code")
  await createUser(request, { name: "Grace Hopper", email, password: "correct horse battery" })

  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("button", { name: "Email sign-in code" }).click()
  await expect(page.getByText("Enter the code sent to")).toBeVisible()
  await page.getByRole("textbox").first().click()
  await page.keyboard.type(await emailedCode(request, email))
  await expect(page).toHaveURL(`${appURL}/`)
  await expect(page.getByText("Grace Hopper")).toBeVisible()
})

test("an unverified account is sent to verify its email", async ({ page, request }) => {
  const email = uniqueEmail("unverified")
  const signUp = await request.post(`${appURL}/api/auth/sign-up/email`, {
    headers: { origin: appURL },
    data: { name: "Alan Turing", email, password: "correct horse battery" },
  })
  expect(signUp.ok()).toBe(true)

  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/verify-email\?email=/)
  await expect(page.getByText(email)).toBeVisible()
})

test("links to sign up and to reset the password with the email filled in", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("link", { name: "Sign up" }).click()
  await expect(page).toHaveURL(/\/signup$/)
  await page.goto("/login")
  await page.getByLabel("Email").fill("ada@example.com")
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("link", { name: "Forgot your password?" }).click()
  await expect(page.getByLabel("Email")).toHaveValue("ada@example.com")
})
