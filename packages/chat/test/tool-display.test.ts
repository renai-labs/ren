import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session/message"
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
    expect(ToolDisplay.label(tool("question", "completed"))).toBe("Asked")
    expect(ToolDisplay.label(tool("read", "error"))).toBe("Failed to read")
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
    expect(ToolDisplay.subtitle(tool("grep", "completed", { path: "src", pattern: "TODO" }))).toBe("TODO in src")
    expect(ToolDisplay.subtitle(tool("glob", "completed", { pattern: "*.txt" }))).toBe("*.txt")
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

  test("lists unique web search links without trailing punctuation", () => {
    const output = "See https://a.dev/docs, then (https://b.dev/x). Again https://a.dev/docs."
    expect(ToolDisplay.links(tool("websearch", "completed", {}, { output }))).toEqual([
      "https://a.dev/docs",
      "https://b.dev/x",
    ])
    expect(ToolDisplay.links(tool("read", "completed", {}, { output }))).toEqual([])
  })

  test("pairs answered questions with their answers", () => {
    const questions = [{ question: "Which colour?" }, { question: "Which sizes?" }, { question: "Notes?" }]
    const answered = tool("question", "completed", { questions }, { metadata: { answers: [["Blue"], ["S", "M"], []] } })
    expect(ToolDisplay.answers(answered)).toEqual([
      { question: "Which colour?", answer: "Blue" },
      { question: "Which sizes?", answer: "S, M" },
      { question: "Notes?", answer: "(no answer)" },
    ])
    expect(ToolDisplay.subtitle(answered)).toBe("3 answered")
    expect(ToolDisplay.answers(tool("question", "completed", { questions }))).toEqual([])
    expect(ToolDisplay.subtitle(tool("question", "completed", { questions }))).toBe("3 questions")
  })

  test("counts glob and grep matches when there are any", () => {
    expect(ToolDisplay.matches(tool("glob", "completed", {}, { metadata: { count: 1 } }))).toBe("1 match")
    expect(ToolDisplay.matches(tool("grep", "completed", {}, { metadata: { matches: 12 } }))).toBe("12 matches")
    expect(ToolDisplay.matches(tool("grep", "completed", {}, { metadata: { matches: 0 } }))).toBeUndefined()
    expect(ToolDisplay.matches(tool("list", "completed", {}, { metadata: { count: 3 } }))).toBeUndefined()
  })

  test("lists the files a completed read loaded", () => {
    const read = tool(
      "read",
      "completed",
      { path: "src/a.ts" },
      { metadata: { loaded: ["AGENTS.md", 3, "src/AGENTS.md"] } },
    )
    expect(ToolDisplay.loaded(read)).toEqual(["AGENTS.md", "src/AGENTS.md"])
    expect(ToolDisplay.loaded(tool("read", "running", { path: "src/a.ts" }))).toEqual([])
  })

  test("merges runs of reads, file changes and named skills inside an open group", () => {
    const reasoning: SessionMessage.Reasoning = { type: "reasoning", text: "Planning" }
    const items = [
      tool("read", "completed", { path: "a.ts" }),
      tool("read", "completed", { path: "b.ts" }),
      tool("edit", "completed", { path: "a.ts" }),
      tool("write", "completed", { path: "c.ts" }),
      tool("skill", "completed", { name: "review" }),
      tool("skill", "completed", { name: "deploy" }),
      reasoning,
      tool("read", "completed", { path: "c.ts" }),
      tool("grep", "completed", { pattern: "x" }),
      tool("edit", "error", { path: "d.ts" }),
    ]
    expect(
      ToolDisplay.runs(items).map((run) =>
        run.type === "tools" ? `${run.kind}:${run.tools.map((item) => item.name).join(",")}` : run.item.type,
      ),
    ).toEqual([
      "read:read,read",
      "file:edit,write",
      "skill:skill,skill",
      "reasoning",
      "single:read",
      "single:grep",
      "single:edit",
    ])
  })
})
