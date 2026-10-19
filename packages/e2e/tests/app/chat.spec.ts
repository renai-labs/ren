import { expect, test } from "@playwright/test"
import { createOrganization } from "../lib/servers.js"

test("a member starts a chat, follows the reply, sends again and finds the chat in the sidebar", async ({ page }) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/app/")
  const start = page.getByRole("form", { name: "Start a chat" })
  await start.getByRole("textbox", { name: "Message" }).fill("Plan the launch")
  await start.getByRole("button", { name: "Send" }).click()

  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/)
  const sessionURL = page.url()
  await expect(page.getByText("Plan the launch")).toBeVisible()
  await expect(page.getByText("stub reply")).toBeVisible()

  const composer = page.getByRole("form", { name: "Message Ren" })
  await composer.getByRole("textbox", { name: "Message" }).fill("Add the budget")
  await composer.getByRole("textbox", { name: "Message" }).press("Enter")
  await expect(page.getByText("Add the budget")).toBeVisible()
  await expect(page.getByText("stub reply")).toHaveCount(2)

  await page.goto("/app/")
  await expect(async () => {
    await page.reload()
    await page.getByRole("link", { name: "Stub title" }).click({ timeout: 1_000 })
  }).toPass()
  await expect(page).toHaveURL(sessionURL)
  await expect(page.getByText("Plan the launch")).toBeVisible()
  await expect(page.getByText("stub reply")).toHaveCount(2)
})
