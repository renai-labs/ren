import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

test("an owner works through onboarding and hides it from the sidebar", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/")
  const row = page.getByRole("link", { name: "Onboarding, 0 of 12 steps done" })
  await expect(row).toBeVisible()
  await row.click()

  await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible()
  await expect(page.getByText("Run an agent from a webhook")).toBeVisible()
  await page.getByRole("button", { name: "Import memory" }).click()
  const dialog = page.getByRole("dialog", { name: "Import memory" })
  await dialog.getByRole("button", { name: "Add to memory" }).click()
  await expect(dialog.getByRole("textbox", { name: /Paste the results/ })).toHaveAccessibleDescription(
    /Paste the results from your other AI assistant first\./,
  )
  await dialog.getByRole("textbox", { name: /Paste the results/ }).fill("[2025-03-14] - Prefers short answers.")
  const chat = page.waitForEvent("popup")
  await dialog.getByRole("button", { name: "Add to memory" }).click()
  await expect(new URL((await chat).url()).searchParams.get("prompt")).toContain("Prefers short answers.")
  await expect(page.getByText("Step complete")).toBeVisible()
  await expect(page.getByRole("button", { name: /Completed/ })).toContainText("1")

  await page.goto("/")
  const progress = page.getByRole("link", { name: "Onboarding, 1 of 12 steps done" })
  await progress.hover()
  await page.getByRole("button", { name: "Hide onboarding" }).click()
  await expect(page.getByText("Onboarding hidden")).toBeVisible()
  await expect(progress).toBeHidden()
})
