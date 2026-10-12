import { expect, story } from "../support/story.js"

story("shows the tooltip while the trigger is hovered", async ({ visit, page }) => {
  await (await visit("ui-tooltip--closed")).getByRole("button", { name: "Share" }).hover()
  const tooltip = page.getByText("Copy a link to this session")
  await expect(tooltip).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(tooltip).toBeHidden()
})

story("shows the tooltip while the trigger has keyboard focus", async ({ visit, page }) => {
  const trigger = (await visit("ui-tooltip--closed")).getByRole("button", { name: "Share" })
  await page.keyboard.press("Tab")
  await expect(trigger).toBeFocused()
  const tooltip = page.getByText("Copy a link to this session")
  await expect(tooltip).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(tooltip).toBeHidden()
})

story("waits for the provider delay before opening on hover", async ({ visit, page }) => {
  await page.clock.install()
  const trigger = (await visit("ui-tooltip--closed")).getByRole("button", { name: "Share" })
  await page.clock.pauseAt(Date.now() + 60_000)
  await trigger.hover()
  const tooltip = page.getByText("Copy a link to this session")
  await page.clock.runFor(450)
  await expect(tooltip).toBeHidden()
  await page.clock.runFor(100)
  await expect(tooltip).toBeVisible()
})

story("opens without delay when the trigger asks for none", async ({ visit, page }) => {
  await (await visit("ui-tooltip--instant")).getByRole("button", { name: "Share" }).hover()
  await expect(page.getByText("Copy a link to this session")).toBeVisible({ timeout: 300 })
})
