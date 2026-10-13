import { mkdir, readdir, writeFile } from "fs/promises"
import path from "path"
import { Schema } from "effect"
import { expect, story } from "../support/story.js"
import type { Appearance } from "../support/story.js"

const StorybookIndex = Schema.Struct({
  entries: Schema.Record(Schema.String, Schema.Struct({ id: Schema.String, type: Schema.String })),
})

const appearances: ReadonlyArray<Appearance> = ["dark", "light"]
const files = await readdir(import.meta.dirname)
const components = files.filter((file) => file.endsWith(".stories.tsx")).map((file) => file.replace(".stories.tsx", ""))

for (const component of components) {
  story(`${component} matches ren-v1`, async ({ visit, page, request }, testInfo) => {
    const index = Schema.decodeUnknownSync(StorybookIndex)(await (await request.get("/index.json")).json())
    const ids = Object.values(index.entries)
      .filter((entry) => entry.type === "story" && entry.id.startsWith(`parity-${component}--`))
      .map((entry) => entry.id)
    expect(ids, "Start Storybook with REN_V1_PATH set so it loads the parity stories.").not.toEqual([])
    for (const id of ids) {
      for (const theme of appearances) {
        const name = `${id.replace(/^parity-/, "")}-${theme}.png`
        const reference = await (await visit(id, { theme })).screenshot({ animations: "disabled", caret: "hide" })
        const snapshot = testInfo.snapshotPath(name, { kind: "screenshot" })
        await mkdir(path.dirname(snapshot), { recursive: true })
        await writeFile(snapshot, reference)
        await expect
          .soft(await visit(id.replace(/^parity-/, "ui-"), { theme }), `${id} in ${theme}`)
          .toHaveScreenshot(name)
      }
      await page.goto("about:blank")
    }
  })
}
