import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { createOrganization, mailboxURL } from "../lib/servers.js"

const brainStart = 30_000

test.describe.configure({ timeout: 90_000 })

test("a member queues two messages while Ren works, sends one now and removes the other", async ({ page }) => {
  await createOrganization(page.request, { name: "Margaret Hamilton" })
  await page.goto("/")
  await page.getByRole("textbox", { name: "Message" }).fill("Plan the launch")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  const held = await page.request.post(`${mailboxURL}/hold`)
  const marker = Schema.decodeUnknownSync(Schema.Struct({ marker: Schema.String }))(await held.json()).marker
  const message = page.getByRole("textbox", { name: "Message" })
  const delivered = (text: string) =>
    page.waitForRequest((request) => request.method() === "POST" && (request.postData() ?? "").includes(text))
  const working = delivered("Hold the turn")
  await message.fill(`Hold the turn ${marker}`)
  await message.press("Enter")
  await working
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({ timeout: brainStart })

  await message.fill("First queued")
  await message.press("Enter")
  await message.fill("Second queued")
  await message.press("Enter")
  const waiting = page.getByRole("list", { name: "Queued messages" })
  await expect(waiting.getByRole("listitem")).toHaveCount(2)
  await expect(waiting.getByRole("listitem").first()).toContainText("First queued")

  const steered = page.waitForRequest(
    (request) => request.method() !== "GET" && (request.postData() ?? "").includes('"delivery":"steer"'),
  )
  await waiting.getByRole("listitem").nth(1).getByRole("button", { name: "Send now" }).click()
  await steered
  await expect(waiting.getByText("Second queued")).toHaveCount(0)

  await waiting.getByRole("button", { name: "Remove" }).click()
  await expect(waiting).toHaveCount(0)
  await page.request.post(`${mailboxURL}/release?marker=${marker}`)
})
