import { expect, test } from "@playwright/test"
import { ports } from "../lib/env.js"
import { createOrganization } from "../lib/servers.js"

const brainStart = 30_000

// oxlint-disable-next-line ren/no-comments -- Ren reads LiteLLM's model list every 30 s (HR28).
const listRead = 45_000

const controlURL = `http://127.0.0.1:${ports.mailbox}/models`

const entry = (providerKey: string, modelKey: string, name: string) => ({
  model_name: modelKey,
  model_info: {
    model_key: modelKey,
    provider_key: providerKey,
    display_name: name,
    max_input_tokens: 100_000,
    max_output_tokens: 4000,
  },
})

// oxlint-disable-next-line ren/no-comments -- The stub LiteLLM's list in script/serve.ts (StubModel.defaultModels).
const defaults = [
  entry("stub", "stub-model", "Stub"),
  entry("stub", "stub-other", "Stub Other"),
  entry("anthropic", "stub-claude", "Stub Claude"),
]

test.describe.configure({ timeout: 180_000 })

test("U3: a model added in LiteLLM appears in the picker, and a chat started with it works", async ({ page }) => {
  await createOrganization(page.request, { name: "Mary Jackson" })
  expect(
    (await page.request.post(controlURL, { data: [...defaults, entry("stub", "stub-added", "Stub Added")] })).status(),
  ).toBe(204)
  try {
    await page.goto("/app/")
    const start = page.getByRole("form", { name: "Start a chat" })
    await expect(async () => {
      await page.reload()
      await start.getByRole("button", { name: /^Model: / }).click({ timeout: 2_000 })
      await page.getByRole("menuitemradio", { name: "Stub Added" }).click({ timeout: 2_000 })
    }).toPass({ timeout: listRead })
    await start.getByRole("textbox", { name: "Message" }).fill("Use the new model")
    await start.getByRole("button", { name: "Send" }).click()
    await expect(page).toHaveURL(/\/sessions\/ses_\w+$/, { timeout: brainStart })
    await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })
    await expect(
      page.getByRole("form", { name: "Message Ren" }).getByRole("button", { name: /^Model: Stub Added/ }),
    ).toBeVisible()
  } finally {
    await page.request.post(controlURL, { data: defaults })
  }
})
