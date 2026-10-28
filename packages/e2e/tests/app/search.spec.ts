import { expect, test } from "@playwright/test"
import { appURL, createUser, uniqueEmail } from "../lib/servers.js"

test("searches actions and settings from the sidebar and the keyboard", async ({ page }) => {
  await createUser(page.request, { name: "Ada Lovelace", email: uniqueEmail("search") })
  await page.goto("/app/")
  await expect(page.getByRole("combobox", { name: /Switch organization/ })).toContainText("Ada Lovelace")

  await page.keyboard.press("ControlOrMeta+k")
  const dialog = page.getByRole("dialog", { name: "Search" })
  const search = dialog.getByRole("combobox", { name: "Search" })
  await expect(search).toBeFocused()
  await expect(dialog.getByRole("option", { name: /Use Light Theme/ })).toBeVisible()
  await expect(dialog.getByRole("option", { name: /Members/ })).toBeVisible()

  await search.fill("zzz")
  await expect(dialog.getByText("No results.")).toBeVisible()
  await search.fill("appearance")
  await dialog.getByRole("option", { name: /Use Light Theme/ }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator("html")).toHaveClass(/light/)

  await page.getByRole("button", { name: "Search" }).click()
  await page.getByRole("combobox", { name: "Search" }).fill("prefer")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(`${appURL}/settings/preferences`)

  await page.keyboard.press("ControlOrMeta+k")
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Search" })).toBeHidden()
})
