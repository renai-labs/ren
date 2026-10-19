import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session-message"
import { DateTime } from "effect"
import { ToolDisplay } from "../src/tool-display.js"

const tool = (
  name: string,
  status: SessionMessage.ToolState["status"],
  input: typeof SessionMessage.Json.Type = {},
  fields: {
    readonly metadata?: typeof SessionMessage.Json.Type
    readonly output?: string
    readonly error?: string
  } = {},
): SessionMessage.Tool => {
  const states: Record<SessionMessage.ToolState["status"], SessionMessage.ToolState> = {
    streaming: { status: "streaming", input: JSON.stringify(input) },
    running: { status: "running", input, metadata: fields.metadata ?? {} },
    completed: {
      status: "completed",
      input,
      content: [{ type: "text", text: fields.output ?? "done" }],
      ...(fields.metadata && { metadata: fields.metadata }),
    },
    error: {
      status: "error",
      input,
      error: { type: "ToolExecutionError", message: fields.error ?? `${name} failed` },
      ...(fields.metadata && { metadata: fields.metadata }),
    },
  }
  return { type: "tool", id: `tool_${name}`, name, state: states[status], time: { created: DateTime.makeUnsafe(1) } }
}

describe("tool display", () => {
  test("labels a running tool by its action and a finished one by its result", () => {
    expect(ToolDisplay.label(tool("read", "running"))).toBe("Reading")
    expect(ToolDisplay.label(tool("read", "completed"))).toBe("Read")
    expect(ToolDisplay.label(tool("shell", "running"))).toBe("Running")
    expect(ToolDisplay.label(tool("shell", "completed"))).toBe("Ran")
    expect(ToolDisplay.label(tool("question", "completed"))).toBe("Asking")
    expect(ToolDisplay.label(tool("read", "error"))).toBe("Reading")
  })

  test("renders an unknown or MCP tool by its readable name", () => {
    expect(ToolDisplay.label(tool("github_create-issue", "completed"))).toBe("Github create issue")
    expect(ToolDisplay.kind(tool("github_create-issue", "completed"))).toBe("tool")
  })

  test("hides todo bookkeeping and a question that is still being asked", () => {
    expect(ToolDisplay.hidden(tool("todowrite", "completed"))).toBe(true)
    expect(ToolDisplay.hidden(tool("todoread", "completed"))).toBe(true)
    expect(ToolDisplay.hidden(tool("question", "running"))).toBe(true)
    expect(ToolDisplay.hidden(tool("question", "completed"))).toBe(false)
  })

  test("shows the subject of each call", () => {
    expect(ToolDisplay.subtitle(tool("shell", "running", { command: "bun test" }))).toBe("bun test")
    expect(ToolDisplay.subtitle(tool("shell", "running", {}, { metadata: { command: "ls" } }))).toBe("ls")
    expect(ToolDisplay.subtitle(tool("execute", "completed", { code: "const a = 1\nconst b = 2" }))).toBe("const a = 1")
    expect(ToolDisplay.subtitle(tool("read", "completed", { filePath: "/repo/src/session.ts" }))).toBe("session.ts")
    expect(ToolDisplay.subtitle(tool("edit", "completed", { path: "src/a.ts" }))).toBe("a.ts")
    expect(ToolDisplay.subtitle(tool("grep", "completed", { path: "src", pattern: "TODO" }))).toBe("src")
    expect(ToolDisplay.subtitle(tool("webfetch", "completed", { url: "https://ren.ai" }))).toBe("https://ren.ai")
    expect(ToolDisplay.subtitle(tool("websearch", "completed", { query: "effect atoms" }))).toBe("effect atoms")
    expect(ToolDisplay.subtitle(tool("skill", "completed", { name: "pdf" }, { metadata: { name: "PDF" } }))).toBe("PDF")
    expect(ToolDisplay.subtitle(tool("question", "completed", { questions: [{}, {}] }))).toBe("2 questions")
    expect(
      ToolDisplay.subtitle(tool("patch", "completed", {}, { metadata: { files: [{ file: "a" }, { file: "b" }] } })),
    ).toBe("2 files")
    expect(ToolDisplay.subtitle(tool("linear_search", "completed", { limit: 3, query: "open bugs" }))).toBe("open bugs")
    expect(ToolDisplay.subtitle(tool("shell", "streaming"))).toBeUndefined()
  })

  test("cleans terminal escapes from command output only", () => {
    expect(ToolDisplay.output(tool("shell", "completed", {}, { output: "\u001b[31mred\u001b[0m\r\n" }))).toBe("red\n")
    expect(ToolDisplay.output(tool("read", "completed", {}, { output: "a\r\nb" }))).toBe("a\r\nb")
  })

  test("uses the output as the error when execute fails with an ok status", () => {
    expect(
      ToolDisplay.error(tool("execute", "completed", {}, { metadata: { error: true }, output: "TypeError: boom" })),
    ).toBe("TypeError: boom")
    expect(ToolDisplay.error(tool("execute", "completed", {}, { metadata: { error: true }, output: "" }))).toBe(
      "Failed",
    )
    expect(ToolDisplay.error(tool("read", "error", {}, { error: "Error: read ENOENT" }))).toBe("Error: read ENOENT")
    expect(ToolDisplay.error(tool("read", "completed"))).toBeUndefined()
  })

  test("summarizes an error by its first clause without the tool prefix", () => {
    expect(ToolDisplay.errorSummary("read", "Error: read file not found: src/a.ts")).toBe("File not found")
    expect(ToolDisplay.errorSummary("shell", "Error: ")).toBe("Failed")
    expect(ToolDisplay.errorSummary("grep", "timeout")).toBe("Timeout")
  })

  test("reports a dismissed question", () => {
    expect(ToolDisplay.dismissed(tool("question", "error", {}, { error: "The user dismissed this question" }))).toBe(
      true,
    )
    expect(ToolDisplay.dismissed(tool("question", "error", {}, { error: "Form expired" }))).toBe(false)
  })

  test("names web search by its provider", () => {
    expect(ToolDisplay.name(tool("websearch", "completed", {}, { metadata: { provider: "exa" } }))).toBe(
      "Exa web search",
    )
    expect(ToolDisplay.name(tool("websearch", "completed", {}, { metadata: { provider: "tinyfish" } }))).toBe(
      "TinyFish web search",
    )
    expect(ToolDisplay.name(tool("websearch", "completed", {}, { metadata: { provider: "opencode" } }))).toBe(
      "OpenCode web search",
    )
    expect(ToolDisplay.name(tool("websearch", "completed"))).toBe("Web search")
  })

  test("labels a context group by its tools, else its thoughts, else updates", () => {
    const reasoning: SessionMessage.Reasoning = { type: "reasoning", text: "Planning" }
    expect(
      ToolDisplay.group([tool("read", "completed"), tool("grep", "completed"), tool("read", "completed"), reasoning]),
    ).toEqual({ title: "Used 3 Read and Grep", count: 3 })
    expect(ToolDisplay.group([{ type: "shell" }, tool("subagent", "completed"), tool("skill", "completed")])).toEqual({
      title: "Used 3 Shell, Agent, and Skill",
      count: 3,
    })
    expect(ToolDisplay.group([reasoning, reasoning])).toEqual({ title: "Used 2 Thoughts", count: 2 })
    expect(ToolDisplay.group([reasoning])).toEqual({ title: "Used 1 Thought", count: 1 })
    expect(ToolDisplay.group([{ type: "notice" }])).toEqual({ title: "Updates", count: 0 })
  })
})
