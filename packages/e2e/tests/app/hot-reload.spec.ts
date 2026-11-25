import { expect, test } from "@playwright/test"
import { ports } from "../lib/env.js"
import { createOrganization } from "../lib/servers.js"

const brainStart = 30_000

const listRead = 45_000

const controlURL = `http://127.0.0.1:${ports.mailbox}/models`

const entry = (providerKey: string, modelKey: string, name: string) => ({
  id: `${providerKey}/${modelKey}`,
  type: "chat",
  protocol: "openai-chat",
  name,
  limit: { context: 100_000, output: 4000 },
})

const defaults = [
  entry("stub", "stub-model", "Stub"),
  entry("stub", "stub-other", "Stub Other"),
  entry("anthropic", "stub-claude", "Stub Claude"),
]

test.describe.configure({ timeout: 180_000 })

test("U3: a model added on models.dev appears in the picker after one push, and a chat started with it works", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Mary Jackson" })
  expect(
    (await page.request.post(controlURL, { data: [...defaults, entry("stub", "stub-added", "Stub Added")] })).status(),
  ).toBe(204)
  try {
    await page.goto("/")
    const start = page.getByRole("main")
    await expect(async () => {
      await page.reload()
      await start.getByRole("button", { name: /^Choose model/ }).click({ timeout: 2_000 })
      await page.getByRole("button", { name: /^Stub Added/ }).click({ timeout: 2_000 })
    }).toPass({ timeout: listRead })
    await start.getByRole("textbox", { name: "Message" }).fill("Use the new model")
    await start.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
    await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
    await expect(page.getByRole("button", { name: /^Choose model, Stub Added/ })).toBeVisible()
  } finally {
    await page.request.post(controlURL, { data: defaults })
  }
})
