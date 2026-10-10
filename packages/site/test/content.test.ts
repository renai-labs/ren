import { expect, test } from "bun:test"

test("docs index has a title", async () => {
  const index = await Bun.file(new URL("../src/content/docs/index.mdx", import.meta.url)).text()
  expect(index).toMatch(/^---\ntitle: .+\n/)
})
