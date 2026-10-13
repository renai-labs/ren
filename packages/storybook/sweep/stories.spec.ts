import AxeBuilder from "@axe-core/playwright"
import { readdir } from "fs/promises"
import path from "path"
import { Schema } from "effect"
import { expect, story } from "../support/story.js"
import type { Appearance } from "../support/story.js"

const StorybookIndex = Schema.Struct({
  entries: Schema.Record(Schema.String, Schema.Struct({ id: Schema.String, type: Schema.String })),
})

const appearances: ReadonlyArray<Appearance> = ["dark", "light", "girliepop"]
const files = await readdir(path.resolve(import.meta.dirname, "../ui"))
const components = files.filter((file) => file.endsWith(".stories.tsx")).map((file) => file.replace(".stories.tsx", ""))

for (const component of components) {
  story(`${component} stories render accessibly`, async ({ visit, page, request }) => {
    story.setTimeout(240_000)
    const index = Schema.decodeUnknownSync(StorybookIndex)(await (await request.get("/index.json")).json())
    const ids = Object.values(index.entries)
      .filter((entry) => entry.type === "story" && entry.id.startsWith(`ui-${component}--`))
      .map((entry) => entry.id)
    expect(ids).not.toEqual([])
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    for (const id of ids) {
      for (const theme of appearances) {
        await visit(id, { theme })
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
              .map((animation) => animation.finished),
          ),
        )
        const results = await new AxeBuilder({ page })
          .exclude("[data-base-ui-focus-guard]")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .disableRules(["region", "landmark-one-main", "page-has-heading-one"])
          .analyze()
        expect
          .soft(
            results.violations.map(
              (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
            ),
            `${id} in ${theme}`,
          )
          .toEqual([])
      }
    }
    expect(errors).toEqual([])
  })
}
