import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session-message"
import { DateTime } from "effect"
import { TimelineText } from "../src/timeline-text.js"

const at = (millis: number) => DateTime.makeUnsafe(millis)

const assistant = (
  id: string,
  content: ReadonlyArray<SessionMessage.Content>,
  fields: Partial<Omit<SessionMessage.Assistant, "id" | "type" | "content">> = {},
): SessionMessage.Assistant => ({
  id: SessionMessage.ID.make(id),
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content,
  time: { created: at(2_000), completed: at(3_000) },
  ...fields,
})

describe("timeline text", () => {
  test("reads the retry from the last assistant before the session status", () => {
    const retrying = assistant("msg_retrying", [], {
      retry: { attempt: 3, at: at(9_000), error: { type: "provider", message: "Rate limited" } },
    })
    expect(TimelineText.retryStatus([assistant("msg_first", []), retrying], undefined)).toEqual({
      attempt: 3,
      message: "Rate limited",
      next: 9_000,
    })
    expect(
      TimelineText.retryStatus([assistant("msg_first", [])], { type: "retry", attempt: 1, message: "Busy", next: 5 }),
    ).toEqual({ attempt: 1, message: "Busy", next: 5 })
    expect(TimelineText.retryStatus([], { type: "busy" })).toBeUndefined()
  })

  test("splits an error at its first colon", () => {
    expect(TimelineText.errorParts("Rate limited: try again in a minute")).toEqual({
      head: "Rate limited:",
      body: " try again in a minute",
    })
    expect(TimelineText.errorParts("Something failed")).toEqual({ head: "", body: "Something failed" })
  })

  test("formats a duration in seconds, then minutes and seconds", () => {
    expect(TimelineText.duration(4_400)).toBe("4s")
    expect(TimelineText.duration(59_600)).toBe("1m 0s")
    expect(TimelineText.duration(125_000)).toBe("2m 5s")
    expect(TimelineText.duration(-1)).toBeUndefined()
  })

  test("measures a turn from the prompt to its latest completed step", () => {
    const user: SessionMessage.User = {
      id: SessionMessage.ID.make("msg_user"),
      type: "user",
      text: "prompt",
      time: { created: at(1_000) },
    }
    expect(
      TimelineText.turnDuration(user, [
        assistant("msg_a", []),
        assistant("msg_b", [], { time: { created: at(3_000), completed: at(7_000) } }),
        assistant("msg_c", [], { time: { created: at(8_000) } }),
      ]),
    ).toBe(6_000)
    expect(TimelineText.turnDuration(user, [assistant("msg_c", [], { time: { created: at(8_000) } })])).toBeUndefined()
    expect(TimelineText.turnDuration(undefined, [assistant("msg_a", [])])).toBeUndefined()
  })

  test("copies only the last non-blank text of a turn", () => {
    expect(
      TimelineText.copyText([
        assistant("msg_a", [{ type: "text", text: "First answer" }]),
        assistant("msg_b", [
          { type: "text", text: "Final answer" },
          { type: "text", text: "  " },
          { type: "reasoning", text: "Thinking" },
        ]),
      ]),
    ).toEqual({ messageID: SessionMessage.ID.make("msg_b"), partID: "msg_b:text:0", text: "Final answer" })
    expect(TimelineText.copyText([assistant("msg_a", [{ type: "reasoning", text: "Thinking" }])])).toBeUndefined()
  })

  test("describes each compaction outcome with its token usage", () => {
    const base = {
      id: SessionMessage.ID.make("msg_compaction"),
      type: "compaction",
      reason: "auto",
      time: { created: at(1) },
    } as const
    const tokens = { input: 1_000, output: 200, reasoning: 100, cache: { read: 500, write: 0 } }
    expect(TimelineText.compaction({ ...base, status: "running", summary: "", recent: "" })).toBe("Compacting")
    expect(TimelineText.compaction({ ...base, status: "completed", summary: "s", recent: "r", tokens })).toBe(
      "Session compacted · 1.5K in · 300 out",
    )
    expect(TimelineText.compaction({ ...base, status: "failed", error: { type: "aborted", message: "Stopped" } })).toBe(
      "Session compaction cancelled",
    )
    expect(
      TimelineText.compaction({
        ...base,
        status: "failed",
        error: { type: "compaction.interrupted", message: "Restarted" },
      }),
    ).toBe("Session compaction interrupted")
    expect(
      TimelineText.compaction({ ...base, status: "failed", error: { type: "provider", message: "Too long" } }),
    ).toBe("Session compaction failed")
  })

  test("describes agent, model and skill notices", () => {
    const time = { created: at(1) }
    expect(
      TimelineText.notice({
        id: SessionMessage.ID.make("msg_agent"),
        type: "agent-switched",
        agent: "plan",
        previous: "build",
        time,
      }),
    ).toEqual({ title: "Agent changed", detail: "Build → Plan" })
    expect(
      TimelineText.notice({
        id: SessionMessage.ID.make("msg_model"),
        type: "model-switched",
        model: { id: "gpt-5", providerID: "openai", variant: "high" },
        time,
      }),
    ).toEqual({ title: "gpt-5 · High" })
    expect(
      TimelineText.notice({
        id: SessionMessage.ID.make("msg_model"),
        type: "model-switched",
        model: { id: "gpt-5", providerID: "openai", variant: "default" },
        time,
      }),
    ).toEqual({ title: "gpt-5" })
    expect(
      TimelineText.notice({
        id: SessionMessage.ID.make("msg_skill"),
        type: "skill",
        skill: "pdf",
        name: "PDF",
        text: "",
        time,
      }),
    ).toEqual({ title: "Skill · PDF" })
    expect(
      TimelineText.notice({ id: SessionMessage.ID.make("msg_synthetic"), type: "synthetic", text: "Restarted", time }),
    ).toEqual({ title: "Restarted" })
  })

  test("strips terminal escapes and carriage returns from shell output", () => {
    expect(TimelineText.shellOutput("\u001b[32mok\u001b[0m\r\nnext\rline")).toBe("ok\nnext\nline")
  })

  test("describes a failed user shell", () => {
    const shell = (fields: Partial<SessionMessage.Shell>): SessionMessage.Shell => ({
      id: SessionMessage.ID.make("msg_shell"),
      type: "shell",
      shellID: "shell_1",
      command: "bun test",
      status: "exited",
      time: { created: at(1) },
      ...fields,
    })
    expect(TimelineText.shellError(shell({ status: "timeout" }))).toBe("Timed out")
    expect(TimelineText.shellError(shell({ status: "killed" }))).toBe("Cancelled")
    expect(TimelineText.shellError(shell({ exit: 2 }))).toBe("Exit 2")
    expect(TimelineText.shellError(shell({ exit: 0 }))).toBeUndefined()
    expect(TimelineText.shellError(shell({ status: "running" }))).toBeUndefined()
  })
})
