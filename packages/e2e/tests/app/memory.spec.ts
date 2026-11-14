import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

test("an owner keeps the organization's memory as a list: a new file opens in a sheet to edit, and folders open in place", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/settings/memory")
  const main = page.getByRole("main")
  await expect(main.getByText("Nothing remembered yet.")).toBeVisible()

  await main.getByRole("button", { name: "New file" }).click()
  await page.getByRole("dialog").getByRole("textbox", { name: "Path" }).fill("people/ana.md")
  await page.getByRole("dialog").getByRole("button", { name: "Create file" }).click()
  const sheet = page.getByRole("dialog", { name: "people/ana.md" })
  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/folder=people%2F&file=people%2Fana\.md/u)

  await sheet.getByRole("button", { name: "Edit" }).click()
  await sheet.getByRole("textbox", { name: "people/ana.md" }).fill("- Ana leads the launch")
  await sheet.getByRole("button", { name: "Save" }).click()
  await expect(sheet.getByText("Ana leads the launch")).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("memory-sheet.png") })
  await page.keyboard.press("Escape")
  await expect(sheet).toHaveCount(0)

  await expect(main.getByRole("navigation", { name: "breadcrumb" })).toContainText("Memorypeople")
  await expect(main.getByRole("link", { name: "ana.md", exact: true })).toBeVisible()
  await main.getByRole("link", { name: "Memory", exact: true }).click()
  await expect(main.getByRole("link", { name: "people", exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("memory.png") })

  await main.getByRole("button", { name: "New file" }).click()
  await page.getByRole("dialog").getByRole("textbox", { name: "Path" }).fill("people/ana.md")
  await page.getByRole("dialog").getByRole("button", { name: "Create file" }).click()
  await expect(page.getByRole("dialog").getByText("people/ana.md already exists.")).toBeVisible()
  await page.getByRole("dialog").getByRole("button", { name: "Open it" }).click()
  await expect(sheet.getByText("Ana leads the launch")).toBeVisible()
  await page.keyboard.press("Escape")

  await expect(main.getByRole("navigation", { name: "breadcrumb" })).toContainText("Memorypeople")
  await main.getByRole("button", { name: "ana.md actions" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click()
  await expect(main.getByRole("link", { name: "ana.md", exact: true })).toHaveCount(0)
})
