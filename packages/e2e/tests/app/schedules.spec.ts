import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 90_000 })

test("a member creates a daily schedule, runs it now, finds the run on the schedule's page and opens the chat it started", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/automations")
  await expect(page.getByText("No schedules yet")).toBeVisible()

  await page.getByRole("button", { name: "Create schedule" }).click()
  const sheet = page.getByRole("dialog", { name: "New schedule" })
  await sheet.getByRole("textbox", { name: "Name" }).fill("Daily report")
  await sheet.getByRole("textbox", { name: "Prompt" }).fill("Summarize the day")
  await sheet.getByRole("button", { name: "Create schedule" }).click()
  await expect(sheet).toHaveCount(0)

  await page.getByRole("link", { name: "Daily report", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Daily report" })).toBeVisible()
  await expect(page.getByText("No runs yet")).toBeVisible()

  await page.getByRole("button", { name: "Run now" }).click()
  await expect(page.getByRole("cell", { name: "Started" })).toBeVisible({ timeout: brainStart })
  await expect(page.getByRole("button", { name: "Started 1" })).toBeVisible()
  await page.getByRole("link", { name: "Open chat" }).click()
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/u)
  await expect(page.getByText("Summarize the day")).toBeVisible({ timeout: brainStart })
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  await page.getByRole("link", { name: "Daily report", exact: true }).click()
  await expect(page.getByRole("cell", { name: "Run now" })).toBeVisible()
})
