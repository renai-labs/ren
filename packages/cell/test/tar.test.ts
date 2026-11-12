import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Tar } from "../src/harness/opencode/tar.js"

const deep = `${"docs/".repeat(25)}guide.md`

test("an archive gives back every file whole under its folder, with a long path split at a slash and non-ASCII names", async () => {
  const files = {
    "index.html": "<h1>Report</h1>",
    "naïve/日本語.md": "# こんにちは",
    [deep]: "x".repeat(1500),
    "empty.txt": "",
  }
  const archive = await Effect.runPromise(Tar.gzip("artifact", files))
  const read = await new Bun.Archive(archive).files()
  expect(
    Object.fromEntries(await Promise.all([...read.values()].map(async (file) => [file.name, await file.text()]))),
  ).toEqual(Object.fromEntries(Object.entries(files).map((entry) => [`artifact/${entry[0]}`, entry[1]])))
})

test("a path with no slash that splits it into ustar's prefix and name is refused", async () => {
  const refused = await Effect.runPromise(Effect.flip(Tar.gzip("artifact", { [`${"a".repeat(120)}.md`]: "x" })))
  expect(refused._tag).toBe("Tar.PathTooLong")
})
