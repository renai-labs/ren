import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

test("the Add apps dialog loads registry apps past the first 100 as it scrolls and finds one by search", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/spaces")
  await page.getByRole("main").getByRole("link", { name: "General Space", exact: true }).click()
  await page.getByRole("link", { name: "Apps", exact: true }).click()
  await page.getByRole("button", { name: "Add app" }).click()
  const apps = page.getByRole("dialog", { name: "Add apps to General Space" }).getByRole("list", { name: "Apps" })
  await expect(apps.getByRole("button", { name: "Docs", exact: true })).toBeVisible()

  const pages = new Set<string>()
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith("/app-registry") && url.searchParams.get("pageSize") === "50")
      pages.add(url.searchParams.get("page") ?? "")
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
