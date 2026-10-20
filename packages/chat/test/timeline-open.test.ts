import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"
import { TimelineDetail } from "../src/timeline-detail.js"
import { TimelineOpen } from "../src/timeline-open.js"

const created = { created: DateTime.makeUnsafe(1) }

const completed = (name: string): SessionMessage.Tool => ({
  type: "tool",
  id: `tool_${name}`,
  name,
  state: { status: "completed", input: {}, content: [{ type: "text", text: "done" }] },
  time: created,
})

const errored = (name: string): SessionMessage.Tool => ({
  type: "tool",
  id: `tool_${name}`,
  name,
  state: { status: "error", input: {}, error: { type: "ToolError", message: "failed" } },
  time: created,
})

const reasoning: SessionMessage.Reasoning = { type: "reasoning", text: "Checking", time: created }

const preset = (id: string) => {
  const found = TimelineDetail.presets.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`no preset ${id}`)
  return found.value
}

describe("content default open", () => {
  test("opens shell, edit and thinking when the detail expands them", () => {
    const everything = preset("everything")
    expect(TimelineOpen.defaultOpen(completed("shell"), everything)).toBe(true)
    expect(TimelineOpen.defaultOpen(completed("edit"), everything)).toBe(true)
    expect(TimelineOpen.defaultOpen(reasoning, everything)).toBe(true)
    const compact = preset("compact")
    expect(TimelineOpen.defaultOpen(completed("shell"), compact)).toBe(false)
    expect(TimelineOpen.defaultOpen(reasoning, compact)).toBe(false)
  })

  test("opens a failed tool in a hidden category", () => {
    expect(TimelineOpen.defaultOpen(errored("webfetch"), preset("quiet"))).toBe(true)
    expect(TimelineOpen.defaultOpen(errored("webfetch"), preset("compact"))).toBe(false)
  })

  test("keeps rows closed without a detail", () => {
    expect(TimelineOpen.defaultOpen(completed("shell"), undefined)).toBe(false)
    expect(TimelineOpen.defaultOpen(reasoning, undefined)).toBe(false)
    expect(TimelineOpen.defaultOpen(completed("read"), undefined)).toBe(false)
  })
})
