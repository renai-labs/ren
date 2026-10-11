import { expect, test } from "@playwright/test"
import type { Locator } from "@playwright/test"

export { expect }

export type Appearance = "dark" | "light" | "girliepop"

export const story = test.extend<{
  visit: (id: string, options?: { theme?: Appearance; args?: Record<string, string | boolean> }) => Promise<Locator>
}>({
  visit: async ({ page }, use) => {
    await use(async (id, options) => {
      const query = new URLSearchParams({ id, viewMode: "story", globals: `theme:${options?.theme ?? "dark"}` })
      const args = Object.entries(options?.args ?? {}).map((entry) => `${entry[0]}:${String(entry[1])}`)
      if (args.length > 0) query.set("args", args.join(";"))
      await page.goto(`/iframe.html?${query}`)
      const root = page.locator("#storybook-root")
      await expect(root).not.toBeEmpty()
      await page.evaluate(() => document.fonts.ready)
      return root
    })
  },
})
