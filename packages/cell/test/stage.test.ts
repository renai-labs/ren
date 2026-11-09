import { expect, test } from "bun:test"
import { Stage } from "../e2b/stage.js"

test("the staged sources are the workspace files the brain and its hand import, at any depth, and no others", async () => {
  const sources = await Stage.sources(Stage.root)
  expect([
    sources.includes("packages/environment-api/src/environment-token.ts"),
    sources.includes("packages/schema/src/signature.ts"),
    sources.includes("packages/schema/src/infra.ts"),
    sources.every((file) => /^packages\/[^/]+\/src\//.test(file)),
  ]).toEqual([true, true, false, true])
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
