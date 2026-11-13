import { expect, test } from "@playwright/test"
import { appOrigin, appURL, createOrganization, organizationName, serverURL } from "../lib/servers.js"
import { Schema } from "effect"

test("the first shell load uses the Ren mark until navigation data arrives", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  const held = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<void>()
  await page.route(/\/spaces\?.*pageSize=100/, async (route) => {
    requested.resolve()
    await held.promise
    await route.continue()
  })
  try {
    await page.goto("/app/")
    await requested.promise
    await expect(page.getByRole("status", { name: "Loading Ren…", exact: true })).toBeVisible()
    await expect(page.getByRole("status", { name: "Loading navigation", exact: true })).toHaveCount(0)
  } finally {
    held.resolve()
  }
  await expect(page.getByRole("button", { name: "General Space", exact: true })).toBeVisible()
})

test("space navigation keeps cached metadata visible", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  await page.addInitScript(() => localStorage.setItem("ren.theme.v1", JSON.stringify("light")))
  const response = await page.request.post(`${serverURL}/spaces`, {
    headers: { origin: appOrigin },
    data: { name: "Research" },
  })
  expect(response.ok()).toBe(true)
  const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await response.json())
  await page.goto("/app/")
  await expect(page.getByRole("button", { name: "Research", exact: true })).toBeVisible()
  const held = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === `/spaces/${space.id}`,
    async (route) => {
      await held.promise
      await route.continue()
    },
  )
  try {
    await page.getByRole("button", { name: "Research actions", exact: true }).click()
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
    await expect(page.getByRole("button", { name: "Switch space (current: Research)", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Inbox", exact: true })).toBeVisible()
    await expect(page.getByRole("list", { name: "Space" }).getByRole("link", { name: "Settings" })).toBeVisible()
    await expect(page.getByRole("status", { name: "Loading navigation", exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath("cached-space-navigation-light.png") })
  } finally {
    held.resolve()
  }
  await expect(page.getByRole("heading", { name: "Settings", exact: true, level: 1 })).toBeVisible()
})

test("expanding chats keeps the sidebar visible without navigation placeholders", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  await page.goto("/app/")
  await expect(page.getByRole("button", { name: "General Space", exact: true })).toBeVisible()
  const held = Promise.withResolvers<void>()
  const requested = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === "/sessions" && url.searchParams.has("spaceId"),
    async (route) => {
      requested.resolve()
      await held.promise
      await route.continue()
    },
  )
  try {
    await page.getByRole("button", { name: "General Space", exact: true }).click()
    await requested.promise
    await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Tasks", exact: true })).toBeVisible()
    await expect(page.getByRole("status", { name: "Loading navigation", exact: true })).toHaveCount(0)
    await expect(page.locator('[data-sidebar="sidebar"] [skullet-loading]')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath("sidebar-chats-pending-dark.png") })
  } finally {
    held.resolve()
  }
  await expect(page.getByRole("region", { name: "Chats in General Space", exact: true })).toContainText("No chats yet")
})

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
