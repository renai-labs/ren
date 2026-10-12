import { expect, story } from "../support/story.js"

story("opens on click and closes when the trigger is clicked again", async ({ visit, page }) => {
  const trigger = (await visit("ui-popover--closed")).getByRole("button", { name: "Display" })
  await trigger.click()
  const popup = page.getByRole("dialog", { name: "Task display" })
  await expect(popup).toBeVisible()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await trigger.click()
  await expect(popup).toBeHidden()
})

story("closes on Escape and returns focus to the trigger", async ({ visit, page }) => {
  const trigger = (await visit("ui-popover--closed")).getByRole("button", { name: "Display" })
  await page.keyboard.press("Tab")
  await expect(trigger).toBeFocused()
  await page.keyboard.press("Enter")
  const popup = page.getByRole("dialog", { name: "Task display" })
  await expect(popup).toBeVisible()
  await expect(page.getByRole("button", { name: "Done" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(popup).toBeHidden()
  await expect(trigger).toBeFocused()
})

story("closes on an outside click", async ({ visit, page }) => {
  await (await visit("ui-popover--closed")).getByRole("button", { name: "Display" }).click()
  const popup = page.getByRole("dialog", { name: "Task display" })
  await expect(popup).toBeVisible()
  await page.mouse.click(4, 4)
  await expect(popup).toBeHidden()
})

story("closes from the close part and returns focus to the trigger", async ({ visit, page }) => {
  const trigger = (await visit("ui-popover--closed")).getByRole("button", { name: "Display" })
  await trigger.click()
  await page.getByRole("button", { name: "Done" }).click()
  await expect(page.getByRole("dialog", { name: "Task display" })).toBeHidden()
  await expect(trigger).toBeFocused()
})

story("opens below the trigger without covering it", async ({ visit, page }) => {
  const trigger = (await visit("ui-popover--closed")).getByRole("button", { name: "Display" })
  await trigger.click()
  const popup = await page.getByRole("dialog", { name: "Task display" }).boundingBox()
  const anchor = await trigger.boundingBox()
  expect(popup?.y ?? 0).toBeGreaterThanOrEqual((anchor?.y ?? 0) + (anchor?.height ?? 0))
  expect(popup?.x ?? 0).toBeCloseTo(anchor?.x ?? 0, 0)
})

story("opens on the requested side and alignment", async ({ visit, page }) => {
  const top = (await visit("ui-popover--top")).getByRole("button", { name: "Display" })
  const above = await page.getByRole("dialog", { name: "Task display" }).boundingBox()
  const topAnchor = await top.boundingBox()
  expect((above?.y ?? 0) + (above?.height ?? 0)).toBeLessThanOrEqual(topAnchor?.y ?? 0)

  const end = (await visit("ui-popover--aligned-end")).getByRole("button", { name: "Display" })
  const below = await page.getByRole("dialog", { name: "Task display" }).boundingBox()
  const endAnchor = await end.boundingBox()
  expect((below?.x ?? 0) + (below?.width ?? 0)).toBeCloseTo((endAnchor?.x ?? 0) + (endAnchor?.width ?? 0), 0)
})
