import { expect, story } from "../story.js"
import type { Appearance } from "../story.js"

story("highlights fenced code with the active theme's syntax colours", async ({ visit }) => {
  const keywordColors = async (theme: Appearance) => {
    const root = await visit("ui-document--code-block", { theme })
    const keyword = root.locator('[data-streamdown="code-block"] code span', { hasText: /^const$/ }).first()
    await expect(keyword).toBeVisible()
    return keyword.evaluate((element) => ({
      keyword: getComputedStyle(element).color,
      prose: getComputedStyle(element.closest('[data-slot="document"]') ?? element).color,
    }))
  }
  const dark = await keywordColors("dark")
  const light = await keywordColors("light")
  expect(dark.keyword).not.toBe(dark.prose)
  expect(light.keyword).not.toBe(light.prose)
  expect(dark.keyword).not.toBe(light.keyword)
})

story("renders markdown in place of its plain-text fallback", async ({ visit }) => {
  const root = await visit("ui-document--compact")
  await expect(root.getByRole("heading", { name: "Release notes" })).toBeVisible()
  await expect(root.getByRole("link", { name: "status page" })).toBeVisible()
  await expect(root.getByText("## Release notes")).toHaveCount(0)
})
