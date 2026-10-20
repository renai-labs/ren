import { expect, test } from "bun:test"
import { SessionTitle } from "./session-title.js"

test.each([
  [undefined, "Session"],
  ["New session - 2026-07-30T18:45:03.662Z", "Session"],
  ["Child session - 2026-07-30T18:45:03.662Z", "Session"],
  ["New session - custom", "New session - custom"],
])("shows %p as %p", (title, expected) => {
  expect(SessionTitle.display(title, "Session")).toBe(expected)
})
