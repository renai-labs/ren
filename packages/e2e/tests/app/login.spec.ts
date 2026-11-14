import { expect, test } from "@playwright/test"
import { appOrigin, createUser, emailedCode, password, serverURL, uniqueEmail } from "../lib/servers.js"

test("signs in with a password and returns to the requested page", async ({ page, request }) => {
  const email = uniqueEmail("login")
  await createUser(request, { name: "Ada Lovelace", email })

  await page.goto("/")
  await expect(page).toHaveURL(/\/login\?redirect=%2F$/)
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByLabel("Email")).toHaveValue(email)
  await page.getByLabel("Password", { exact: true }).fill("wrong password")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password.")
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(`${appOrigin}/`)
  await expect(page.getByRole("combobox", { name: /Switch organization/ })).toContainText("Ada Lovelace")

  await page.goto("/login")
  await expect(page).toHaveURL(`${appOrigin}/`)
})

test("signs in with an emailed code", async ({ page, request }) => {
  const email = uniqueEmail("code")
  await createUser(request, { name: "Grace Hopper", email })

  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await page.getByRole("button", { name: "Email sign-in code" }).click()
  await expect(page.getByText("Enter the code sent to")).toBeVisible()
  const code = await emailedCode(request, email)
  await page.getByRole("textbox").first().click()
  await page.keyboard.type(code)
  await expect(page).toHaveURL(`${appOrigin}/`)
  await expect(page.getByRole("combobox", { name: /Switch organization/ })).toContainText("Grace Hopper")
})

test("an unverified account is sent to verify its email", async ({ page, request }) => {
  const email = uniqueEmail("unverified")
  await createUser(request, { name: "Alan Turing", email, verify: false })

  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/verify-email\?email=/)
  await expect(page.getByText(email)).toBeVisible()
})

test("continues with Google and comes back to the app", async ({ page }) => {
  await page.route(/accounts\.google\.com/, (route) => route.abort())
  await page.goto("/login?redirect=%2Fsettings")
  const request = page.waitForRequest(/accounts\.google\.com/)
  await page.getByRole("button", { name: "Continue with Google" }).click()
  const google = new URL((await request).url())
  expect(google.searchParams.get("redirect_uri")).toBe(`${serverURL}/auth/callback/google`)
})
