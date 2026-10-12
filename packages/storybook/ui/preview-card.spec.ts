import { expect, story } from "../support/story.js"

const content = "Design review · 4 open tasks, last updated 2 hours ago."

story("opens after the hover delay and closes when the pointer leaves", async ({ visit, page }) => {
  await page.clock.install()
  const trigger = (await visit("ui-preview-card--closed")).getByRole("button", { name: "Design review" })
  await page.clock.pauseAt(Date.now() + 60_000)
  await trigger.hover()
  const card = page.getByText(content)
  await page.clock.runFor(550)
  await expect(card).toBeHidden()
  await page.clock.runFor(100)
  await expect(card).toBeVisible()
  await page.mouse.move(0, 0)
  await page.clock.runFor(400)
  await expect(card).toBeHidden()
})

story("opens while the trigger has keyboard focus", async ({ visit, page }) => {
  const trigger = (await visit("ui-preview-card--closed")).getByRole("button", { name: "Design review" })
  await page.keyboard.press("Tab")
  await expect(trigger).toBeFocused()
  const card = page.getByText(content)
  await expect(card).toBeVisible()
  await page.keyboard.press("Tab")
  await expect(card).toBeHidden()
})

story("opens on the requested side", async ({ visit, page }) => {
  const trigger = (await visit("ui-preview-card--right")).getByRole("button", { name: "Design review" })
  const card = await page.getByText(content).boundingBox()
  const anchor = await trigger.boundingBox()
  expect(card?.x ?? 0).toBeGreaterThanOrEqual((anchor?.x ?? 0) + (anchor?.width ?? 0))
})
