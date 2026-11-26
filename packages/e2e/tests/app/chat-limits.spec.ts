import { expect, test, type Page } from "@playwright/test"
import { createOrganization, script, setFreeUsed } from "../lib/servers.js"

const brainStart = 30_000

const listRead = 45_000

test.describe.configure({ timeout: 120_000 })

// oxlint-disable-next-line ren/no-comments -- The inference service's final refusals carry `x-should-retry: false`, so the brain shows the error at once.
const final = { "x-should-retry": "false" }

const chooseModel = async (page: Page, name: RegExp) => {
  await page.getByRole("button", { name: /^Choose model/ }).click()
  await page.getByRole("button", { name }).click()
}

test("the model chip names the provider, and Free on a free model", async ({ page }) => {
  await createOrganization(page.request, { name: "Hedy Lamarr" })
  await page.goto("/")
  const chip = page.getByRole("main").getByRole("button", { name: /^Choose model/ })
  await expect(async () => {
    await page.reload()
    await chooseModel(page, /^Stub Free/u)
  }).toPass({ timeout: listRead })
  await expect(chip).toHaveText(/Ren\s*\/\s*Stub Free · Free/u)
  await chooseModel(page, /^Stub Other/u)
  await expect(chip).toHaveText(/Ren\s*\/\s*Stub Other$/u)
})

test("the picker finds a model by any words of its name and its provider, and groups each provider under its name", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Grace Hopper" })
  await page.goto("/")
  await expect(async () => {
    await page.reload()
    await page.getByRole("button", { name: /^Choose model/ }).click()
    await expect(page.getByRole("heading", { name: /^Ren/u })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: listRead })
  const search = page.getByRole("textbox", { name: "Search models or providers" })
  await search.fill("ren other")
  await expect(page.getByRole("button", { name: /^Stub Other/u })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Stub Free/u })).toHaveCount(0)
  await search.fill("other ren")
  await expect(page.getByRole("button", { name: /^Stub Other/u })).toBeVisible()
  await search.fill("groq other")
  await expect(page.getByText("No models found")).toBeVisible()
})

test("the inference service's refusals show their error card at once, and Change model opens the picker", async ({
  page,
}) => {
  await createOrganization(page.request, { name: "Hedy Lamarr" })
  await page.goto("/")
  // oxlint-disable-next-line ren/no-comments -- An HTTP-runtime model: the Claude runtime passes on the inference service's message without its code.
  await expect(async () => {
    await page.reload()
    await chooseModel(page, /^Stub Other/u)
  }).toPass({ timeout: listRead })
  const composer = page.getByRole("main").getByRole("textbox", { name: "Message" })
  const credits = await script(page.request, { status: 402, code: "insufficient_credits", headers: final })
  await composer.fill(`Plan the launch ${credits}`)
  await composer.press("Enter")
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/u, { timeout: brainStart })
  const outOfCredits = page.getByRole("alert").filter({ hasText: "You’re out of Ren credits." })
  await expect(outOfCredits).toBeVisible({ timeout: brainStart })
  await expect(outOfCredits.getByRole("link", { name: "Add credits" })).toBeVisible()
  await expect(outOfCredits.getByRole("button", { name: "Change model" })).toBeVisible()
  await expect(outOfCredits.getByRole("link", { name: "Providers" })).toBeVisible()

  const free = await script(page.request, { status: 429, code: "free_limit_reached", headers: final })
  await composer.fill(`Try again ${free}`)
  await composer.press("Enter")
  await expect(page.getByText("Free models: today’s 100 requests are used.")).toBeVisible({ timeout: brainStart })
  await expect(page.getByText("They reset at 00:00 UTC.")).toBeVisible()

  const off = await script(page.request, { status: 403, code: "model_off", headers: final })
  await composer.fill(`Once more ${off}`)
  await composer.press("Enter")
  const switchedOff = page.getByRole("alert").filter({ hasText: /is switched off for this organization\./u })
  await expect(switchedOff).toBeVisible({ timeout: brainStart })
  await switchedOff.getByRole("button", { name: "Change model" }).click()
  await expect(page.getByRole("button", { name: /^Stub Free/u })).toBeVisible()
})

test("the free-model banner shows each step once, and again at the next step", async ({ page }) => {
  await createOrganization(page.request, { name: "Hedy Lamarr" })
  await setFreeUsed(page.request, 76)
  await page.goto("/")
  await expect(async () => {
    await page.reload()
    await chooseModel(page, /^Stub Free/u)
  }).toPass({ timeout: listRead })
  const composer = page.getByRole("main").getByRole("textbox", { name: "Message" })
  await composer.fill("Plan the launch")
  await composer.press("Enter")
  await expect(page).toHaveURL(/\/sessions\/ses_\w+$/u, { timeout: brainStart })
  await expect(page.getByText("stub reply")).toBeVisible({ timeout: brainStart })

  const banner = (used: number) => page.getByText(`Free models: ${used} of 100 today · resets 00:00 UTC`)
  await expect(async () => {
    await page.reload()
    await expect(banner(76)).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: listRead })
  await page.getByRole("button", { name: "Dismiss" }).click()
  await expect(banner(76)).toBeHidden()

  await composer.fill("Add the budget")
  await composer.press("Enter")
  await expect(page.getByText("stub reply")).toHaveCount(2, { timeout: brainStart })
  await expect(banner(76)).toBeHidden()

  await setFreeUsed(page.request, 81)
  await composer.fill("Add the timeline")
  await composer.press("Enter")
  await expect(page.getByText("stub reply")).toHaveCount(3, { timeout: brainStart })
  await expect(banner(81)).toBeVisible({ timeout: brainStart })
})
