import { expect, test } from "@playwright/test"
import { addMember, appURL, createOrganization, uniqueEmail } from "../lib/servers.js"

test("an owner renames the organization", async ({ page }) => {
  const owner = await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/sessions/settings/general")
  await expect(page.getByRole("heading", { level: 1, name: "General" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Edit Organization name" })).toHaveText(owner.organization)
  await page.getByRole("button", { name: "Edit Organization name" }).click()
  await page.getByRole("textbox", { name: "Name" }).fill("Renamed Inc")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "Edit Organization name" })).toHaveText("Renamed Inc")
  await page.getByRole("link", { name: "Back to app" }).click()
  await expect(page.getByRole("combobox", { name: "Switch organization (current: Renamed Inc)" })).toBeVisible()
})

test("a member is sent to preferences instead of organization settings", async ({ page, request }) => {
  await createOrganization(request, { name: "Grace Hopper" })
  await addMember(request, page.request, { name: "Alan Turing", email: uniqueEmail("member") })
  await page.goto("/sessions/settings/general")
  await expect(page).toHaveURL(`${appURL}/sessions/settings/preferences`)
  await page.goto("/org/settings")
  await expect(page).toHaveURL(`${appURL}/sessions/settings/preferences`)
})
