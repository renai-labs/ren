import { expect, story } from "../support/story.js"

story("copies its value and confirms it", async ({ visit, page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const root = await visit("ui-copy-button--labelled")
  await root.getByRole("button", { name: "Copy access token" }).click()
  await expect(root.getByRole("button", { name: "Copied" })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ren_live_4f9a2c")
})

story("reports a failed copy", async ({ visit }) => {
  const root = await visit("ui-copy-button--failing")
  await root.getByRole("button", { name: "Copy" }).click()
  await expect(root.getByRole("button", { name: "Copy failed. Try again" })).toBeVisible()
})

story("keeps the click from reaching the surrounding row", async ({ visit, page }) => {
  const root = await visit("ui-copy-button--failing")
  await page.evaluate(() =>
    document.body.addEventListener("click", () => document.body.setAttribute("data-row-clicked", "")),
  )
  await root.getByRole("button", { name: "Copy" }).click()
  await expect(root.getByRole("button", { name: "Copy failed. Try again" })).toBeVisible()
  await expect(page.locator("body")).not.toHaveAttribute("data-row-clicked")
})
