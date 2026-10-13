import { expect, test } from "@playwright/test"
import type { Locator } from "@playwright/test"
import type { Theme } from "@ren/ui/theme"

export { expect }

export const story = test.extend<{
  visit: (
    id: string,
    options?: { theme?: Theme.Appearance; args?: Record<string, string | boolean> },
  ) => Promise<Locator>
}>({
  visit: async ({ page }, use) => {
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback, not a React hook
    await use(async (id, options) => {
      const query = new URLSearchParams({ id, viewMode: "story", globals: `theme:${options?.theme ?? "dark"}` })
      const args = Object.entries(options?.args ?? {}).map((entry) => `${entry[0]}:${String(entry[1])}`)
      if (args.length > 0) query.set("args", args.join(";"))
      await page.goto(`/iframe.html?${query}`)
      const root = page.locator("#storybook-root")
      await root.locator(":scope > *").first().waitFor({ state: "attached" })
      await page.evaluate(() => document.fonts.ready)
      return root
    })
  },
})
