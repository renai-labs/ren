import { expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { FileReadQuery } from "../src/chat.js"

test("a file path stays inside the session's folder: an absolute path or one with `..` is refused", () => {
  const read = Schema.decodeUnknownOption(FileReadQuery)
  expect(
    ["src/a.ts", "notes/", ".env", "a..b/c", "/etc/passwd", "../a", "src/../../a"].map((path) =>
      Option.isSome(read({ path })),
    ),
  ).toEqual([true, true, true, true, false, false, false])
})
