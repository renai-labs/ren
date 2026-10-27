import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Factory } from "@ren/schema/factory"
import { TaskFactory } from "../src/task/factory.js"

const factory = Schema.decodeUnknownSync(Factory.Info)({
  maxHandoffs: 6,
  agents: [
    { agentId: "plan", to: [{ agentId: "build", start: "new" }] },
    { agentId: "build", to: [{ agentId: "review" }] },
    { agentId: "review", to: [{ agentId: "qa" }, { agentId: "build", max: 2, start: "continue" }] },
    { agentId: "qa", maxRuns: 2, to: [{ agentId: "build", max: 1, else: "review" }] },
    { agentId: "docs" },
  ],
})

const names = new Map([
  ["build", "Build"],
  ["review", "Review"],
  ["qa", "QA"],
])

const next = (input: {
  readonly from: string
  readonly holder?: string
  readonly to: string | null
  readonly start?: Factory.StartMode
  readonly handoffs?: ReadonlyArray<TaskFactory.Handoff>
  readonly runs?: ReadonlyArray<string>
}) =>
  TaskFactory.next(factory, {
    from: input.from,
    holder: input.holder ?? input.from,
    to: input.to,
    start: input.start,
    history: { handoffs: input.handoffs ?? [], runs: input.runs ?? [] },
    names,
  })

describe("TaskFactory.next", () => {
  test("a governed agent hands off along an edge, with the edge's start mode", () => {
    expect(next({ from: "plan", to: "build" })).toEqual({ _tag: "assign", agentId: "build", start: "new" })
  })

  test("the caller's start mode wins over the edge's", () => {
    expect(next({ from: "plan", to: "build", start: "continue" })).toEqual({
      _tag: "assign",
      agentId: "build",
      start: "continue",
    })
  })

  test("a governed agent cannot hand off outside its edges, and learns which agents it can use", () => {
    expect(next({ from: "build", to: "qa" })).toEqual({
      _tag: "refuse",
      message: "Build can hand off only to Review.",
    })
  })

  test("a governed agent hands off only a task that it holds, and never clears the task's agent", () => {
    expect(next({ from: "build", holder: "review", to: "review" })._tag).toBe("conflict")
    expect(next({ from: "build", to: null })._tag).toBe("refuse")
  })

  test("an agent with no edges, or outside the factory, hands off to any agent", () => {
    expect(next({ from: "docs", to: "plan" })).toEqual({ _tag: "assign", agentId: "plan", start: undefined })
    expect(next({ from: "ren", to: "qa" })).toEqual({ _tag: "assign", agentId: "qa", start: undefined })
  })

  test("an edge at its limit goes to human review", () => {
    const handoffs = [
      { from: "review", to: "build" },
      { from: "review", to: "build" },
    ]
    expect(next({ from: "review", to: "build", handoffs })).toEqual({
      _tag: "review",
      reason: "Review → Build used 2 of 2.",
    })
  })

  test("an edge at its limit goes to its else agent, with a note that says why", () => {
    expect(next({ from: "qa", to: "build", handoffs: [{ from: "qa", to: "build" }] })).toEqual({
      _tag: "assign",
      agentId: "review",
      start: undefined,
      note: "Review got the task instead of Build: QA → Build used 1 of 1.",
    })
  })

  test("an agent at its run limit gets no more handoffs, from any agent", () => {
    expect(next({ from: "review", to: "qa", runs: ["qa", "build", "qa"] })).toEqual({
      _tag: "review",
      reason: "QA ran 2 of 2 times.",
    })
    expect(next({ from: "docs", to: "qa", runs: ["qa", "qa"] })._tag).toBe("review")
  })

  test("the handoff limit counts only the handoffs of governed agents", () => {
    const governed = [
      { from: "plan", to: "build" },
      { from: "build", to: "review" },
      { from: "review", to: "qa" },
    ]
    const free = [
      { from: "docs", to: "plan" },
      { from: "ren", to: "plan" },
      { from: "docs", to: "plan" },
    ]
    expect(next({ from: "plan", to: "build", handoffs: [...governed, ...free] })._tag).toBe("assign")
    expect(next({ from: "plan", to: "build", handoffs: [...governed, ...governed] })).toEqual({
      _tag: "review",
      reason: "The task was handed off 6 of 6 times.",
    })
  })
})
