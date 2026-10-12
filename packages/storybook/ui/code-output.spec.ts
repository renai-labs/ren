import { expect, story } from "../support/story.js"

story("keeps every character of a highlighted shell command", async ({ visit }) => {
  const code = (await visit("ui-code-output--shell")).locator("pre")
  await expect(code.locator("span").nth(1)).toBeAttached()
  await expect(code).toHaveText('ren login --token "$REN_TOKEN" && ren sessions list --limit 5 | head\nren whoami', {
    useInnerText: true,
  })
})

story("scrolls overflowing output from the keyboard", async ({ visit, page }) => {
  const output = (await visit("ui-code-output--bounded")).getByRole("region", { name: "Output" })
  await page.keyboard.press("Tab")
  await expect(output).toBeFocused()
  await page.keyboard.press("PageDown")
  await expect.poll(() => output.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

story("copies the copy text instead of the shown content", async ({ visit, page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const root = await visit("ui-code-output--copy-text")
  await root.getByRole("button", { name: "Copy" }).click()
  await expect(root.getByRole("button", { name: "Copied" })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ren_live_4f9a2c")
})
