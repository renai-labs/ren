import { expect, story } from "../support/story.js"

story("names the trigger after the model and picks another model", async ({ visit, page }) => {
  const root = await visit("ui-model-picker--default")
  await root.getByRole("button", { name: "Model: Claude Haiku" }).click()
  await page.getByRole("menuitemradio", { name: "GPT" }).click()
  await expect(root.getByRole("status", { name: "Selection" })).toHaveText("openai/gpt")
  await expect(root.getByRole("button", { name: "Model: GPT" })).toBeVisible()
})

story("picks a reasoning effort from the model's submenu", async ({ visit, page }) => {
  const root = await visit("ui-model-picker--default")
  await root.getByRole("button", { name: "Model: Claude Haiku" }).click()
  await page.getByRole("menuitem", { name: "Claude Sonnet" }).click()
  await page.getByRole("menuitemradio", { name: "High" }).click()
  await expect(root.getByRole("status", { name: "Selection" })).toHaveText("anthropic/claude-sonnet high")
  await expect(root.getByRole("button", { name: "Model: Claude Sonnet, reasoning effort: High" })).toBeVisible()
  await expect(page.getByRole("menu")).toHaveCount(0)
})

story("returns to the default effort", async ({ visit, page }) => {
  const root = await visit("ui-model-picker--with-effort")
  await root.getByRole("button", { name: "Model: Claude Sonnet, reasoning effort: High" }).click()
  await page.getByRole("menuitem", { name: /Claude Sonnet/ }).click()
  await page.getByRole("menuitemradio", { name: "Default" }).click()
  await expect(root.getByRole("status", { name: "Selection" })).toHaveText("anthropic/claude-sonnet")
})

story("cannot open while models load", async ({ visit }) => {
  const root = await visit("ui-model-picker--loading")
  await expect(root.getByRole("button", { name: "Model: Loading…" })).toBeDisabled()
})

story("opens from a command and takes the keyboard", async ({ visit, page }) => {
  const root = await visit("ui-model-picker--open-from-command")
  await root.getByRole("button", { name: "Choose model" }).click()
  await expect(page.getByRole("menu")).toBeVisible()
  await expect(page.getByRole("menu")).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(root.getByRole("status", { name: "Selection" })).toHaveText("openai/gpt")
  await expect(page.getByRole("menu")).toHaveCount(0)
})
