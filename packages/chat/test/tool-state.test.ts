import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session-message"
import { DateTime } from "effect"
import { ToolState } from "../src/tool-state.js"

const time = { created: DateTime.makeUnsafe(1) }

describe("current tool state", () => {
  test("decodes complete streaming input", () => {
    const tool: SessionMessage.Tool = {
      type: "tool",
      id: "tool_streaming",
      name: "edit",
      state: { status: "streaming", input: '{"path":"src/session.ts"}' },
      time,
    }

    expect(ToolState.input(tool)).toEqual({ path: "src/session.ts" })
    expect(ToolState.metadata(tool)).toEqual({})
  })

  test("uses an empty input until streaming JSON is complete", () => {
    const tool: SessionMessage.Tool = {
      type: "tool",
      id: "tool_partial",
      name: "edit",
      state: { status: "streaming", input: '{"path":' },
      time,
    }

    expect(ToolState.input(tool)).toEqual({})
  })

  test("preserves running input and metadata", () => {
    const input = { command: "bun test src/timeline" }
    const metadata = { background: true, output: "Running timeline tests..." }
    const tool: SessionMessage.Tool = {
      type: "tool",
      id: "tool_running",
      name: "shell",
      state: { status: "running", input, metadata },
      time,
    }

    expect(ToolState.input(tool)).toBe(input)
    expect(ToolState.metadata(tool)).toBe(metadata)
    expect(ToolState.output(tool)).toBe("Running timeline tests...")
  })

  test("reads completed text without converting file content", () => {
    const metadata = { loaded: ["src/session.ts"] }
    const tool: SessionMessage.Tool = {
      type: "tool",
      id: "tool_completed",
      name: "read",
      state: {
        status: "completed",
        input: { path: "src/session.ts" },
        content: [
          { type: "text", text: "first" },
          { type: "file", mime: "text/plain", uri: "file:///src/session.ts", name: "session.ts" },
          { type: "text", text: "second" },
        ],
        metadata,
      },
      time,
    }

    expect(ToolState.output(tool)).toBe("first\nsecond")
    expect(ToolState.metadata(tool)).toBe(metadata)
  })

  test("keeps structured errors at the current boundary", () => {
    const tool: SessionMessage.Tool = {
      type: "tool",
      id: "tool_error",
      name: "shell",
      state: {
        status: "error",
        input: { command: "bun test" },
        error: { type: "ToolExecutionError", message: "Command failed" },
      },
      time,
    }

    expect(ToolState.error(tool)).toBe("Command failed")
    expect(ToolState.output(tool)).toBeUndefined()
  })
})

const completed = (name: string, files: ReadonlyArray<typeof SessionMessage.Json.Type> = []): SessionMessage.Tool => ({
  type: "tool",
  id: `tool_${name}`,
  name,
  state: { status: "completed", input: {}, content: [{ type: "text", text: "done" }], metadata: { files } },
  time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
})

describe("live shell output", () => {
  const shell = (state: SessionMessage.ToolState): SessionMessage.Tool => ({
    type: "tool",
    id: "tool_shell",
    name: "shell",
    state,
    time,
  })
  const content = [{ type: "text", text: "done" }] as const

  test("follows a shell's output until its saved snapshot ended it", () => {
    expect<string | undefined>(
      ToolState.liveShellID(shell({ status: "running", input: {}, metadata: { shellID: "sh_live" } })),
    ).toBe("sh_live")
    expect<string | undefined>(
      ToolState.liveShellID(
        shell({ status: "completed", input: {}, content, metadata: { status: "running", shellID: "sh_background" } }),
      ),
    ).toBe("sh_background")
    expect(
      ToolState.liveShellID(
        shell({ status: "completed", input: {}, content, metadata: { status: "exited", shellID: "sh_saved" } }),
      ),
    ).toBeUndefined()
    expect(ToolState.liveShellID(shell({ status: "running", input: {}, metadata: {} }))).toBeUndefined()
  })
})

describe("current content default open", () => {
  test("uses the shell disclosure preference", () => {
    expect(ToolState.defaultOpen(completed("shell"), true, false)).toBe(true)
    expect(ToolState.defaultOpen(completed("execute"), false, true)).toBe(false)
  })

  test("uses the file-change disclosure preference", () => {
    expect(ToolState.defaultOpen(completed("edit"), false, true)).toBe(true)
    expect(ToolState.defaultOpen(completed("write"), false, false)).toBe(false)
    expect(ToolState.defaultOpen(completed("patch"), false, false)).toBe(false)
    expect(ToolState.defaultOpen(completed("patch"), false, true)).toBe(true)
  })

  test("collapses errored tools regardless of disclosure preferences", () => {
    const errored = (name: string): SessionMessage.Tool => ({
      type: "tool",
      id: `tool_${name}`,
      name,
      state: {
        status: "error",
        input: {},
        error: { type: "ToolError", message: "Tool execution interrupted" },
        metadata: {},
      },
      time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
    })

    expect(ToolState.defaultOpen(errored("shell"), true, true)).toBe(false)
    expect(ToolState.defaultOpen(errored("execute"), true, true)).toBe(false)
    expect(ToolState.defaultOpen(errored("edit"), true, true)).toBe(false)
    expect(ToolState.defaultOpen(errored("patch"), false, false)).toBe(false)
  })

  test("opens deletion-only patches", () => {
    expect(
      ToolState.defaultOpen(
        completed("patch", [
          { file: "src/one.ts", patch: "", additions: 0, deletions: 1, status: "deleted" },
          { file: "src/two.ts", patch: "", additions: 0, deletions: 1, status: "deleted" },
        ]),
        false,
        true,
      ),
    ).toBe(true)
  })
})
