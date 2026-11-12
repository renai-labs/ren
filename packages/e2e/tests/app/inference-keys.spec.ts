import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

test("a member creates an inference key, copies it once, opens its usage and revokes it", async ({ page }) => {
  await createOrganization(page.request, { name: "Ada Lovelace" })
  await page.goto("/app/settings/providers")
  await page.getByRole("link", { name: "Inference keys" }).click()
  await expect(page.getByText("No inference keys yet")).toBeVisible()

  await page.getByRole("button", { name: "Create key" }).first().click()
  const dialog = page.getByRole("dialog", { name: "Create inference key" })
  await dialog.getByRole("button", { name: "Create key" }).click()
  await expect(dialog.getByText("Enter a name.")).toBeVisible()
  await dialog.getByRole("textbox", { name: "Name" }).fill("Work laptop")
  await dialog.getByRole("button", { name: "Create key" }).click()

  const copy = page.getByRole("dialog", { name: "Copy your key" })
  await expect(copy.getByText("Ren shows this key only once.")).toBeVisible()
  await expect(copy.getByRole("textbox", { name: "Key" })).toHaveValue(/^sk-ren-/u)
  await copy.getByRole("button", { name: "Done" }).click()

  const row = page.getByRole("row", { name: /Work laptop/u })
  await expect(row.getByText("Active")).toBeVisible()
  await expect(row.getByText("Never used")).toBeVisible()
  await row.getByRole("button", { name: "Work laptop", exact: true }).click()
  await expect(page.getByText("No calls in the last 30 days.")).toBeVisible()

  await row.getByRole("button", { name: "Work laptop actions" }).click()
  await page.getByRole("menuitem", { name: "Revoke" }).click()
  await page.getByRole("dialog", { name: "Revoke Work laptop?" }).getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByText("Work laptop revoked")).toBeVisible()
  await expect(page.getByText("No active keys. Switch to All to see revoked and expired keys.")).toBeVisible()
  await page.getByRole("tab", { name: /All/u }).click()
  await expect(page.getByRole("row", { name: /Work laptop/u }).getByText("Revoked")).toBeVisible()
})
