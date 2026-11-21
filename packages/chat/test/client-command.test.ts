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
  const all = {
    "model.choose": true,
    "session.compact": true,
    "session.undo": true,
    "session.redo": true,
    "session.new": true,
    "panel.terminal": true,
    "file.open": true,
    "session.rename": true,
    "apps.open": true,
  }

  test("lists the client commands first and hides one the brain also names", () => {
    const listed = ClientCommand.suggestions(
      ClientCommand.offered(all),
      [
        { name: "compact", description: "The brain’s compaction" },
        { name: "open", description: "The brain’s open" },
        { name: "review", description: "Review the change" },
      ],
      "",
    )
    expect(listed.map((item) => [item.trigger, item.client])).toEqual([
      ["model", "model.choose"],
      ["undo", "session.undo"],
      ["redo", "session.redo"],
      ["clear", "session.new"],
      ["terminal", "panel.terminal"],
      ["rename", "session.rename"],
      ["apps", "apps.open"],
      ["compact", undefined],
      ["open", undefined],
      ["review", undefined],
    ])
    expect(new Set(listed.map((item) => item.value)).size).toBe(listed.length)
  })

  test("filters both lists by the typed query", () => {
    expect(
      ClientCommand.suggestions(ClientCommand.offered(all), [{ name: "review" }], "RE").map((item) => item.trigger),
    ).toEqual(["redo", "rename", "review"])
  })

  test("lists only the client commands that are available", () => {
    const available = { ...all, "panel.terminal": false, "file.open": false, "apps.open": false }
    expect(ClientCommand.suggestions(ClientCommand.offered(available), [], "").map((item) => item.trigger)).toEqual([
      "model",
      "compact",
      "undo",
      "redo",
      "clear",
      "rename",
    ])
  })

  test("/new finds /clear", () => {
    expect(
      ClientCommand.suggestions(ClientCommand.offered(all), [], "new").map((item) => [item.trigger, item.client]),
    ).toEqual([["clear", "session.new"]])
  })

  test("/open and /rename take the text after them", () => {
    expect(ClientCommand.parse(ClientCommand.offered(all), "/open src/app.tsx")).toEqual({
      id: "file.open",
      input: "src/app.tsx",
    })
    expect(ClientCommand.parse(ClientCommand.offered(all), "/rename Board memo")).toEqual({
      id: "session.rename",
      input: "Board memo",
    })
    expect(ClientCommand.parse(ClientCommand.offered(all), "/terminal now")).toBeUndefined()
  })
})
