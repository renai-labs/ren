import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { appOrigin, appURL, createUser, organizationName, password, serverURL } from "../lib/servers.js"

async function signedIn(page: Page) {
  const company = `Initech${crypto.randomUUID().slice(0, 8)}`
  await createUser(page.request, {
    name: "Ada Lovelace",
    email: `ada@${company.toLowerCase()}.com`,
    password,
  })
  return company
}

test("the sidebar collapses with the keyboard and remembers it", async ({ page }) => {
  await signedIn(page)
  await page.goto("/app/")
  await expect(page).toHaveURL(`${appURL}/`)
  const navigation = page.getByRole("complementary", { name: "Navigation" })
  await expect(navigation.getByRole("link", { name: "Ren home" })).toBeVisible()
  await expect(navigation.getByRole("link", { name: "New chat" }).first()).toHaveAttribute("aria-current", "page")
  await expect(navigation.getByText("Your conversations will appear here once you start chatting!")).toBeVisible()

  await page.keyboard.press("ControlOrMeta+b")
  await expect(navigation.getByRole("button", { name: "Expand sidebar" })).toBeVisible()
  await expect(navigation.getByRole("link", { name: "Ren home" })).toBeHidden()
  await page.reload()
  await expect(navigation.getByRole("button", { name: "Expand sidebar" })).toBeVisible()
  await navigation.getByRole("button", { name: "Expand sidebar" }).click()
  await expect(navigation.getByRole("button", { name: "Collapse sidebar" })).toBeVisible()
})

test("switches organization and logs out from the profile card", async ({ page }) => {
  const company = await signedIn(page)
  const created = await page.request.post(`${serverURL}/auth/organization/create`, {
    headers: { origin: appOrigin },
    data: {
      name: "Side Project",
      slug: `side-${crypto.randomUUID().slice(0, 8)}`,
      keepCurrentActiveOrganization: true,
    },
  })
  expect(created.ok()).toBe(true)

  await page.goto("/app/")
  await page.getByRole("combobox", { name: `Switch organization (current: ${company})` }).click()
  await expect(page.getByRole("option", { name: company })).toHaveAttribute("aria-selected", "true")
  await page.getByPlaceholder("Find organization").fill("side")
  await expect(page.getByRole("option", { name: company })).toBeHidden()
  await page.getByRole("option", { name: "Side Project" }).click()
  await expect(page.getByRole("combobox", { name: "Switch organization (current: Side Project)" })).toBeVisible()
  expect(await organizationName(page.request)).toBe("Side Project")

  await page.getByRole("combobox", { name: "Switch organization (current: Side Project)" }).click()
  await page.getByRole("button", { name: "Log out" }).click()
  const dialog = page.getByRole("alertdialog", { name: "Log out?" })
  await expect(dialog).toContainText("You’ll need to sign in again to access Ren.")
  await dialog.getByRole("button", { name: "Log out" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto("/app/")
  await expect(page).toHaveURL(/\/login\?redirect=/)
})

test("unknown pages go to the app and mobile hides the sidebar in a drawer", async ({ page }) => {
  await signedIn(page)
  await page.goto("/app/somewhere/else")
  await expect(page).toHaveURL(`${appURL}/`)

  await page.setViewportSize({ width: 390, height: 800 })
  await expect(page.getByRole("complementary", { name: "Navigation" })).toBeHidden()
  await page.getByRole("button", { name: "Open navigation" }).click()
  await expect(page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Ren home" })).toBeVisible()
})
