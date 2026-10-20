import { describe, expect, test } from "bun:test"
import { ClientCommand } from "../src/client-command.js"

const options = [
  { id: "btw.ask", trigger: "btw", arguments: true, type: "builtin" as const },
  { id: "custom.btw", trigger: "custom", type: "custom" as const },
  { id: "model.choose", trigger: "model", type: "builtin" as const },
]

test.each([
  { text: "/btw why this approach?", result: { id: "btw.ask", input: "why this approach?" } },
  { text: "/btw\nwhy this approach?", result: { id: "btw.ask", input: "why this approach?" } },
  { text: "/btw", result: { id: "btw.ask", input: "" } },
  { text: "/btwx nope", result: undefined },
  { text: "/custom nope", result: undefined },
  { text: "/model opus", result: undefined },
  { text: "ask /btw later", result: undefined },
])("parses $text as a client argument command", (row) => {
  expect(ClientCommand.parse(options, row.text)).toEqual(row.result)
})

describe("client commands in the / list", () => {
  const all = { "model.choose": true, "session.compact": true, "session.undo": true, "session.redo": true }

  test("lists the brain’s commands first and hides a client command the brain also names", () => {
    const listed = ClientCommand.suggestions(
      ClientCommand.offered(all),
      [
        { name: "compact", description: "The brain’s compaction" },
        { name: "review", description: "Review the change" },
      ],
      "",
    )
    expect(listed.map((item) => [item.trigger, item.client])).toEqual([
      ["compact", undefined],
      ["review", undefined],
      ["model", "model.choose"],
      ["undo", "session.undo"],
      ["redo", "session.redo"],
    ])
    expect(new Set(listed.map((item) => item.value)).size).toBe(listed.length)
  })

  test("filters both lists by the typed query", () => {
    expect(
      ClientCommand.suggestions(ClientCommand.offered(all), [{ name: "review" }], "RE").map((item) => item.trigger),
    ).toEqual(["review", "redo"])
  })
})
