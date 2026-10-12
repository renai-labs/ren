import { expect, story } from "../support/story.js"

story("opens the row actions aligned to the trigger's end", async ({ visit, page }) => {
  const trigger = (await visit("ui-row-actions-menu--default")).getByRole("button", {
    name: "Actions for Ada Lovelace",
  })
  await trigger.click()
  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Remove" })).toBeVisible()
  const triggerBox = await trigger.boundingBox()
  const menuBox = await menu.boundingBox()
  expect(Math.round((menuBox?.x ?? 0) + (menuBox?.width ?? 0))).toBe(
    Math.round((triggerBox?.x ?? 0) + (triggerBox?.width ?? 0)),
  )
})
