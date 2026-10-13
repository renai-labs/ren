import { expect, test } from "@playwright/test"
import { appURL, createUser, uniqueEmail } from "../lib/servers.js"

test("searches actions and settings from the sidebar and the keyboard", async ({ page }) => {
  await createUser(page.request, { name: "Ada Lovelace", email: uniqueEmail("search"), password: "first password" })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeVisible()

  await page.keyboard.press("ControlOrMeta+k")
  const dialog = page.getByRole("dialog", { name: "Search" })
  const search = dialog.getByRole("combobox", { name: "Search" })
  await expect(search).toBeFocused()
  await expect(search).toHaveAttribute("placeholder", "Search actions and settings…")
  await expect(dialog.getByRole("option", { name: /Use Light Theme/ })).toBeVisible()
  await expect(dialog.getByRole("option", { name: /Members/ })).toBeVisible()

  await page.keyboard.press("Tab")
  await expect(dialog.getByRole("tab", { name: "Actions" })).toHaveAttribute("aria-selected", "true")
  await expect(search).toHaveAttribute("placeholder", "Search actions…")
  await expect(dialog.getByRole("option", { name: /Members/ })).toBeHidden()
  await page.keyboard.press("Shift+Tab")
  await expect(dialog.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true")

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
