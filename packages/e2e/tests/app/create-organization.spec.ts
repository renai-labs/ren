import { expect, test } from "@playwright/test"
import { appURL, createUser } from "../lib/servers.js"

test("creates an organization from the profile card and switches to it", async ({ page }) => {
  const company = `Globex${crypto.randomUUID().slice(0, 8)}`
  await createUser(page.request, {
    name: "Ada Lovelace",
    email: `ada@${company.toLowerCase()}.com`,
    password: "correct horse battery",
  })
  await page.goto("/sessions")
  await page.getByRole("combobox", { name: `Switch organization (current: ${company})` }).click()
  await page.getByRole("button", { name: "Create organization" }).click()

  const dialog = page.getByRole("dialog", { name: "Create organization" })
  await expect(dialog).toContainText("A shared home for your teams and their projects.")
  await dialog.getByRole("button", { name: "Create organization" }).click()
  await expect(dialog.getByText("Name is required.")).toBeVisible()
  await dialog.getByLabel("Name").fill("!!!")
  await expect(dialog.getByText("Use at least one letter or number to generate a slug.")).toBeVisible()

  await dialog.getByLabel("Name").fill(company)
  await expect(dialog.getByText(company.toLowerCase(), { exact: true })).toBeVisible()
  await expect(dialog.getByLabel("Name")).toHaveAccessibleDescription("This slug is already in use.")

  const name = `Moonshot ${crypto.randomUUID().slice(0, 8)}`
  await dialog.getByLabel("Name").fill(name)
  await expect(dialog.getByText(name.toLowerCase().replace(" ", "-"), { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Create organization" }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(`${appURL}/sessions`)
  await expect(page.getByRole("combobox", { name: `Switch organization (current: ${name})` })).toBeVisible()
})
