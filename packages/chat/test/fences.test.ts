import { expect, test } from "bun:test"
import { Fences } from "../src/fences.js"

test("prose is converted and fenced code is left alone, also when a fence never closes", () => {
  const text = "a\n```mermaid\nx\n```\nb\n~~~ts\ny"
  expect(Fences.split(text).map((part) => [part.code, part.info, part.closed])).toEqual([
    [false, "", false],
    [true, "mermaid", true],
    [false, "", false],
    [true, "ts", false],
  ])
  expect(Fences.mapProse(text, (prose) => prose.toUpperCase())).toBe("A\n```mermaid\nx\n```\nB\n~~~ts\ny")
})
