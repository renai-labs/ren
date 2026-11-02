import { expect, test, type Page } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

const isRegistryPage = (url: URL, page: string) =>
  url.pathname.endsWith("/app-registry") &&
  url.searchParams.get("pageSize") === "50" &&
  url.searchParams.get("page") === page

async function openAddApps(page: Page) {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/spaces")
  await page.getByRole("main").getByRole("link", { name: "General Space", exact: true }).click()
  await page.getByRole("link", { name: "Apps", exact: true }).click()
  await page.getByRole("button", { name: "Add app" }).click()
  const apps = page.getByRole("dialog", { name: "Add apps to General Space" }).getByRole("list", { name: "Apps" })
  await expect(apps.getByRole("button", { name: "Docs", exact: true })).toBeVisible()
  return apps
}

test("the Add apps dialog loads registry apps past the first 100 as it scrolls and finds one by search", async ({
  page,
}) => {
  const apps = await openAddApps(page)
  const pages = new Set<string>()
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (isRegistryPage(url, "2") || isRegistryPage(url, "3")) pages.add(url.searchParams.get("page") ?? "")
  })
  const last = apps.getByRole("button", { name: "Filler 110", exact: true })
  await expect(async () => {
    await apps.getByRole("listitem").last().scrollIntoViewIfNeeded()
    await expect(last).toBeVisible({ timeout: 1_000 })
  }).toPass()
  expect([...pages].toSorted()).toEqual(["2", "3"])

  await page.getByRole("textbox", { name: "Search apps" }).fill("Filler 105")
  await expect(apps.getByRole("listitem")).toHaveCount(1)
  await expect(apps.getByRole("button", { name: "Filler 105", exact: true })).toBeVisible()
})

test("the Add apps dialog stops loading after a page fails and loads it on Retry", async ({ page }) => {
  const apps = await openAddApps(page)
  let failures = 0
  await page.route(
    (url) => isRegistryPage(url, "2"),
    async (route) => {
      failures += 1
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
    },
  )
  await apps.getByRole("listitem").last().scrollIntoViewIfNeeded()
  const failed = apps.getByRole("alert")
  await expect(failed).toContainText("Couldn’t load more apps")
  expect(failures).toBe(2)

  await page.unrouteAll()
  await failed.getByRole("button", { name: "Retry" }).click()
  await expect(apps.getByRole("button", { name: "Filler 050", exact: true })).toBeVisible()
  await expect(failed).toHaveCount(0)
})

test("composer @ suggestions find a registry app past the first 100", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  await page
    .getByRole("main")
    .getByRole("textbox", { name: "Message", exact: true })
    .pressSequentially("@e2e-filler-110")
  await expect(page.getByRole("option", { name: /^Filler 110/ })).toBeVisible()
})
