import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 90_000 })

test("a member creates a daily schedule, runs it now and finds the scheduled message in the chat it started", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/schedules")
  await expect(page.getByText("No schedules yet")).toBeVisible()

  await page.getByRole("button", { name: "Create schedule" }).click()
  const dialog = page.getByRole("dialog", { name: "New schedule" })
  await dialog.getByRole("combobox", { name: "Space" }).click()
  await page.getByRole("option").first().click()
  await dialog.getByRole("textbox", { name: "Name" }).fill("Daily report")
  await dialog.getByRole("textbox", { name: "Message" }).fill("Summarize the day")
  await dialog.getByRole("button", { name: "Create schedule" }).click()
  await expect(dialog).toHaveCount(0)

  const card = page.getByRole("button", { name: "Edit schedule: Daily report" })
  await expect(card).toContainText("Every day at 09:00")
  await page.getByRole("switch", { name: "Pause schedule: Daily report" }).click()
  await expect(page.getByRole("switch", { name: "Resume schedule: Daily report" })).not.toBeChecked()
  await card.click()
  await page.getByRole("dialog", { name: "Edit schedule" }).getByRole("link", { name: "View runs" }).click()
  await expect(page.getByRole("heading", { name: "Daily report" })).toBeVisible()
  await expect(page.getByText("No runs yet")).toBeVisible()

  await page.getByRole("button", { name: "Run now" }).click()
  await expect(page.getByText("Started")).toBeVisible({ timeout: brainStart })
  await page.getByRole("link", { name: "Open" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/)
  await expect(page.getByText("Summarize the day")).toBeVisible({ timeout: brainStart })
  await expect(page.getByRole("link", { name: "Daily report", exact: true })).toBeVisible()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
})
