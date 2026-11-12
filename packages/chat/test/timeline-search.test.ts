import { describe, expect, test } from "bun:test"
import { TimelineSearch } from "../src/timeline-search.js"
import { Fixture } from "./lib/fixture.js"

const assistant = (id: string, content: ReadonlyArray<object>) =>
  Fixture.message({
    id,
    type: "assistant",
    agent: "build",
    model: Fixture.model,
    content,
    time: { created: 2, completed: 3 },
  })

const messages = [
  Fixture.user("msg_1", 1, "Fix the Router and the router tests"),
  assistant("msg_2", [
    { type: "reasoning", text: "router reasoning is not searched" },
    { type: "text", text: "Looking at the ROUTER." },
    {
      type: "tool",
      id: "call_1",
      name: "read",
      state: { status: "running", input: { path: "router.ts" }, metadata: {} },
      time: { created: 2 },
    },
    { type: "text", text: "routerrouter" },
  ]),
  Fixture.message({
    id: "msg_3",
    type: "shell",
    shellID: "sh_1",
    command: "ls router",
    status: "exited",
    time: { created: 4 },
  }),
  assistant("msg_4", [{ type: "text", text: "Done with the router." }]),
]

describe("timeline search", () => {
  test("finds trimmed, case-insensitive, non-overlapping matches in user and assistant text only", () => {
    expect(TimelineSearch.matches(messages, "  ROUTER ")).toEqual([
      { messageID: "msg_1", role: "user", revealID: "msg_1", partID: "msg_1:text:0", occurrence: 0 },
      { messageID: "msg_1", role: "user", revealID: "msg_1", partID: "msg_1:text:0", occurrence: 1 },
      { messageID: "msg_2", role: "assistant", revealID: "msg_1", partID: "msg_2:text:0", occurrence: 0 },
      { messageID: "msg_2", role: "assistant", revealID: "msg_1", partID: "msg_2:text:1", occurrence: 0 },
      { messageID: "msg_2", role: "assistant", revealID: "msg_1", partID: "msg_2:text:1", occurrence: 1 },
      { messageID: "msg_4", role: "assistant", revealID: "msg_3", partID: "msg_4:text:0", occurrence: 0 },
    ])
  })

  test("finds nothing for a blank query", () => {
    expect(TimelineSearch.matches(messages, "   ")).toEqual([])
  })

  test("wraps the active match in both directions", () => {
    expect(TimelineSearch.step(0, 3, -1)).toBe(2)
    expect(TimelineSearch.step(2, 3, 1)).toBe(0)
    expect(TimelineSearch.step(5, 3, 1)).toBe(1)
    expect(TimelineSearch.step(0, 0, 1)).toBe(0)
  })
})

describe("timeline search of markdown", () => {
  const found = (text: string, query: string) => TimelineSearch.matches([Fixture.user("msg_1", 1, text)], query).length

  test("searches typeset math as its rendered text", () => {
    expect(found("Inline $$x^2$$ and \\(y_{3}\\)", "x2")).toBe(1)
    expect(found("Inline $$x^2$$ and \\(y_{3}\\)", "y3")).toBe(1)
    expect(found("$$x^2$$", "^")).toBe(0)
  })

  test("skips a closed mermaid fence and keeps other code and an open fence", () => {
    expect(found("```mermaid\nA[Gizmo] --> B\n```\nafter", "gizmo")).toBe(0)
    expect(found("```mermaid\nA[Gizmo] --> B\n```\nafter", "after")).toBe(1)
    expect(found("```ts\nconst gizmo = 1\n```", "gizmo")).toBe(1)
    expect(found("```mermaid\nA[Gizmo] --> B", "gizmo")).toBe(1)
    expect(found("costs $5 and $10", "$5")).toBe(1)
    expect(found("`$$x^2$$`", "x^2")).toBe(1)
  })
})
