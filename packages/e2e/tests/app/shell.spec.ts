import { expect, test } from "@playwright/test"
import { appOrigin, appURL, createOrganization, organizationName, serverURL } from "../lib/servers.js"

test("the sidebar remembers that it was collapsed", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  await page.goto("/app/")
  const navigation = page.getByRole("complementary", { name: "Navigation" })
  await navigation.getByRole("button", { name: "Collapse sidebar" }).click()
  await expect(navigation.getByRole("button", { name: "Expand sidebar" })).toBeVisible()
  await page.reload()
  await expect(navigation.getByRole("button", { name: "Expand sidebar" })).toBeVisible()
})

test("switches organization and logs out from the profile card", async ({ page }) => {
  const company = (await createOrganization(page.request, { name: "Ada Lovelace" })).organization
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

test("an unknown page goes to the app", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  await page.goto("/app/somewhere/else")
  await expect(page).toHaveURL(`${appURL}/`)
})
