import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { appearances } from "../support/appearances.js"
import { expect, story } from "../support/story.js"
import { prefixes, storyComponents, storyIds } from "../support/stories.js"

const parityAppearances = appearances.filter((appearance) => appearance !== "girliepop")
const components = await storyComponents(import.meta.dirname)

for (const component of components) {
  story(`${component} matches ren-v1`, async ({ visit, page, request }, testInfo) => {
    const ids = await storyIds(request, prefixes.parity, component)
    expect(ids, "Start Storybook with REN_V1_PATH set so it loads the parity stories.").not.toEqual([])
    for (const id of ids) {
      for (const theme of parityAppearances) {
        const name = `${id.replace(prefixes.parity, "")}-${theme}.png`
        const reference = await (await visit(id, { theme })).screenshot({ animations: "disabled", caret: "hide" })
        const snapshot = testInfo.snapshotPath(name, { kind: "screenshot" })
        await mkdir(path.dirname(snapshot), { recursive: true })
        await writeFile(snapshot, reference)
        await expect
          .soft(await visit(id.replace(prefixes.parity, prefixes.ui), { theme }), `${id} in ${theme}`)
          .toHaveScreenshot(name)
      }
      await page.goto("about:blank")
    }
  })
}
