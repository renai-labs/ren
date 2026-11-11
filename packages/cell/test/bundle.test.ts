import { expect, test } from "bun:test"
import { BundleBuild } from "../machine/bundle.js"

test("the staged sources are the workspace files the brain and its hand import, at any depth, and no others", async () => {
  const sources = await BundleBuild.sources(BundleBuild.root)
  expect([
    sources.includes("packages/hand-api/src/hand-token.ts"),
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
  expect([
    BundleBuild.hash(files) === BundleBuild.hash(files.toReversed()),
    BundleBuild.hash(files) === BundleBuild.hash(changed),
  ]).toEqual([true, false])
})
