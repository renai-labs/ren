import { expect, test } from "bun:test"
import { Schema } from "effect"
import { join } from "node:path"
import { Stage } from "../e2b/stage.js"

const Manifest = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

test("the staged files include every workspace dependency of @ren/cell and @ren/executor, followed through each level", async () => {
  const staged = await Stage.files(Stage.root)
  const manifests = await Promise.all(
    staged
      .filter((file) => /^packages\/[^/]+\/package\.json$/.test(file))
      .map(async (file) => ({
        directory: file.slice(0, -"/package.json".length),
        manifest: Schema.decodeUnknownSync(Manifest)(await Bun.file(join(Stage.root, file)).json()),
      })),
  )
  const hasSource = (directory: string) => staged.some((file) => file.startsWith(`${directory}/src/`))
  const directoryOf = new Map(manifests.map((each) => [each.manifest.name, each.directory]))
  const missing = manifests
    .filter((each) => hasSource(each.directory))
    .flatMap((each) =>
      Object.entries(each.manifest.dependencies ?? {})
        .filter((dependency) => dependency[1].startsWith("workspace:"))
        .flatMap((dependency) => {
          const directory = directoryOf.get(dependency[0])
          return directory && hasSource(directory) ? [] : [`${each.manifest.name} → ${dependency[0]}`]
        }),
    )
  expect([missing, hasSource("packages/cell"), hasSource("packages/executor")]).toEqual([[], true, true])
})

test("a changed staged file changes the hash, and the same files give the same hash", () => {
  const files = [
    { path: "packages/cell/src/a.ts", content: new TextEncoder().encode("one") },
    { path: "packages/cell/src/b.ts", content: new TextEncoder().encode("two") },
  ]
  const changed = [files[0], { path: "packages/cell/src/b.ts", content: new TextEncoder().encode("three") }].flatMap(
    (file) => (file ? [file] : []),
  )
  expect([Stage.hash(files) === Stage.hash(files.toReversed()), Stage.hash(files) === Stage.hash(changed)]).toEqual([
    true,
    false,
  ])
})
