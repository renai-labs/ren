import { expect, test } from "bun:test"
import path from "path"

const html = await Bun.file(path.resolve(import.meta.dir, "../index.html")).text()
const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? ""

test("the document declares its language", () => {
  expect(html).toMatch(/<html lang="[a-z]{2}/)
})

test("the viewport lets people zoom", () => {
  expect(viewport).not.toMatch(/maximum-scale|user-scalable/)
})

test("the viewport extends under device safe areas so env(safe-area-inset-*) resolves", () => {
  expect(viewport).toContain("viewport-fit=cover")
})
