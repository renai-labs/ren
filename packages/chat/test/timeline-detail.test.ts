import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"
import { TimelineDetail } from "../src/timeline-detail.js"

const synthetic = (metadata: SessionMessage.Synthetic["metadata"]): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.make("msg_synthetic"),
  type: "synthetic",
  text: "done",
  description: "Background work completed",
  ...(metadata && { metadata }),
  time: { created: DateTime.makeUnsafe(1) },
})

const levels = {
  everything: TimelineDetail.presets[0].value,
  detailed: TimelineDetail.presets[1].value,
  compact: TimelineDetail.presets[2].value,
  quiet: TimelineDetail.presets[3].value,
  "text-only": TimelineDetail.presets[4].value,
}

const value = (id: keyof typeof levels) => levels[id]

describe("timeline detail", () => {
  test("identifies each preset and no other value", () => {
    expect(TimelineDetail.presets.map((candidate) => TimelineDetail.preset(candidate.value)?.id)).toEqual([
      "everything",
      "detailed",
      "compact",
      "quiet",
      "text-only",
    ])
    expect(TimelineDetail.preset({ ...value("compact"), commentary: { placement: "grouped" } })).toBeUndefined()
    expect(TimelineDetail.preset({ ...value("compact"), shell: { placement: "grouped", details: "expanded" } })).toBe(
      undefined,
    )
  })

  test("keeps subagents separate and commentary visible below Everything", () => {
    expect(
      TimelineDetail.presets.map((candidate) => [
        candidate.value.subagents.placement,
        candidate.value.commentary.placement,
      ]),
    ).toEqual([
      ["separate", "separate"],
      ["separate", "separate"],
      ["separate", "separate"],
      ["separate", "separate"],
      ["hidden", "separate"],
    ])
  })

  test.each([
    ["everything", "separate"],
    ["compact", "grouped"],
    ["quiet", "hidden"],
  ] as const)("places a plain notice as %s", (id, placement) => {
    expect(TimelineDetail.noticePlacement(synthetic({}), value(id))).toBe(placement)
  })

  test("shows background outcomes as their own rows, and subagents follow their own setting", () => {
    const subagent = synthetic({ source: "subagent", childID: "ses_child" })
    const shell = synthetic({ source: "shell", shellID: "sh_1", state: "completed", exit: 0 })
    expect(TimelineDetail.noticePlacement(subagent, value("compact"))).toBe("separate")
    expect(TimelineDetail.noticePlacement(shell, value("compact"))).toBe("separate")
    expect(TimelineDetail.noticePlacement(subagent, value("quiet"))).toBe("separate")
    expect(TimelineDetail.noticePlacement(shell, value("quiet"))).toBe("hidden")
    expect(TimelineDetail.noticePlacement(subagent, value("text-only"))).toBe("hidden")
  })

  test("requires errored notices, failed shells and unfinished compactions", () => {
    const failed = synthetic({ source: "shell", shellID: "sh_1", state: "completed", exit: 1 })
    expect(TimelineDetail.noticeRequired(failed)).toBe(true)
    expect(TimelineDetail.noticeRequired(synthetic({ source: "subagent", state: "error" }))).toBe(true)
    expect(TimelineDetail.noticeRequired(synthetic({ source: "shell", state: "completed", exit: 0 }))).toBe(false)
    expect(TimelineDetail.noticePlacement(failed, value("text-only"))).toBe("separate")
    const running: SessionMessage.CompactionRunning = {
      id: SessionMessage.ID.make("msg_compaction"),
      type: "compaction",
      status: "running",
      reason: "auto",
      summary: "",
      recent: "",
      time: { created: DateTime.makeUnsafe(1) },
    }
    expect(TimelineDetail.noticeRequired(running)).toBe(true)
  })

  test("names the category of each content", () => {
    const tool = (name: string): SessionMessage.Tool => ({
      type: "tool",
      id: name,
      name,
      state: { status: "streaming", input: "" },
      time: { created: DateTime.makeUnsafe(1) },
    })
    expect(["bash", "apply_patch", "task", "grep"].map((name) => TimelineDetail.category(tool(name)))).toEqual([
      "shell",
      "edit",
      "subagents",
      "tools",
    ])
    expect(TimelineDetail.category({ type: "reasoning", text: "x" })).toBe("thinking")
    expect(TimelineDetail.category({ type: "text", text: "x" })).toBeUndefined()
  })
})
