import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session/message"
import { SessionTasks } from "../src/session-tasks.js"
import { Fixture } from "./lib/fixture.js"

const todowrite = (
  id: string,
  todos: unknown,
  status: "running" | "completed" | "error" | "streaming" = "completed",
) => {
  const input = { todos }
  const states = {
    streaming: { status: "streaming", input: JSON.stringify(input).slice(0, 12) },
    running: { status: "running", input, metadata: {} },
    completed: { status: "completed", input, content: [{ type: "text", text: "ok" }] },
    error: { status: "error", input, error: { type: "ToolExecutionError", message: "failed" } },
  }
  return { type: "tool", id: `prt_${id}`, name: "todowrite", state: states[status], time: { created: 1 } }
}

const assistant = (id: string, created: number, content: ReadonlyArray<object>): SessionMessage.Info =>
  Fixture.message({
    id,
    type: "assistant",
    agent: "build",
    model: Fixture.model,
    content,
    time: { created },
  })

describe("session tasks", () => {
  test("restores the latest todowrite input", () => {
    const messages = [
      Fixture.user("msg_1", 1),
      assistant("msg_2", 2, [todowrite("a", [{ content: "Read the spec", status: "in_progress" }])]),
      assistant("msg_3", 3, [
        todowrite("b", [
          { id: "1", content: "Read the spec", status: "completed" },
          { id: "2", content: "Write the test", status: "in_progress", priority: "high" },
        ]),
      ]),
    ]
    expect(SessionTasks.latest(messages)).toEqual([
      { id: "1", content: "Read the spec", status: "completed" },
      { id: "2", content: "Write the test", status: "in_progress" },
    ])
  })

  test("ignores a todowrite that is still streaming or failed", () => {
    const messages = [
      assistant("msg_2", 2, [todowrite("a", [{ content: "Read the spec", status: "pending" }])]),
      assistant("msg_3", 3, [
        todowrite("b", [{ content: "Broken", status: "pending" }], "error"),
        todowrite("c", [{ content: "Partial", status: "pending" }], "streaming"),
      ]),
    ]
    expect(SessionTasks.latest(messages)).toEqual([{ id: "0", content: "Read the spec", status: "pending" }])
  })

  test("drops todos it cannot read and keeps the rest", () => {
    const messages = [
      assistant("msg_2", 2, [
        todowrite("a", [{ content: "Ship it", status: "pending" }, { content: 4, status: "pending" }, "loose"]),
      ]),
    ]
    expect(SessionTasks.latest(messages)).toEqual([{ id: "0", content: "Ship it", status: "pending" }])
  })

  test("has no tasks without a todowrite", () => {
    expect(SessionTasks.latest([Fixture.user("msg_1", 1)])).toEqual([])
  })

  test("is unfinished while a task is pending or in progress", () => {
    expect(SessionTasks.unfinished([{ id: "1", content: "Ship it", status: "completed" }])).toBe(false)
    expect(
      SessionTasks.unfinished([
        { id: "1", content: "Ship it", status: "cancelled" },
        { id: "2", content: "Tell the team", status: "pending" },
      ]),
    ).toBe(true)
  })
})
