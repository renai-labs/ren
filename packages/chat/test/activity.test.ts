import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"
import { Activity } from "../src/activity.js"

const turn = (content: ReadonlyArray<SessionMessage.Content>, completed = false): SessionMessage.Assistant => ({
  id: SessionMessage.ID.make("msg_b"),
  type: "assistant",
  agent: "build",
  model: { id: "stub", providerID: "stub" },
  content,
  time: { created: DateTime.makeUnsafe(2), ...(completed && { completed: DateTime.makeUnsafe(3) }) },
})

const done = (name: string, input: typeof SessionMessage.Json.Type = {}): SessionMessage.Tool => ({
  type: "tool",
  id: `tool_${name}_done`,
  name,
  state: { status: "completed", input, content: [] },
  time: { created: DateTime.makeUnsafe(1) },
})

const running = (name: string, input: typeof SessionMessage.Json.Type = {}): SessionMessage.Tool => ({
  type: "tool",
  id: `tool_${name}`,
  name,
  state: { status: "running", input, metadata: {} },
  time: { created: DateTime.makeUnsafe(1) },
})

const streaming = (name: string, input: string): SessionMessage.Tool => ({
  type: "tool",
  id: `tool_${name}`,
  name,
  state: { status: "streaming", input },
  time: { created: DateTime.makeUnsafe(1) },
})

describe("activity", () => {
  test("the line the model wrote wins over every other source", () => {
    expect(Activity.of(running("shell", { command: "gh issue list", activity: "Searching GitHub issues" }))).toEqual({
      text: "Searching GitHub issues",
      kind: "command",
      app: "github",
    })
  })

  test("a call still streaming its input already shows its line once the line is complete", () => {
    expect(Activity.of(streaming("shell", '{"command":"ls","activity":"Looking around"}')).text).toBe("Looking around")
    expect(Activity.of(streaming("shell", '{"command":"ls","activity":"Look')).text).toBe("Running a command")
  })

  test("code that calls an app tool shows the app and the action of its first call", () => {
    const code = 'const found = await tools.github__work.list_issues({ state: "open" })\nreturn found'
    expect(Activity.of(running("execute", { code }))).toEqual({ text: "Listing issues", kind: "tool", app: "github" })
    expect(Activity.of(running("execute", { code: 'await tools["linear"].update_issue({})' }))).toEqual({
      text: "Updating issue",
      kind: "tool",
      app: "linear",
    })
  })

  test("code that calls only OpenCode's own tools or no tool has no app", () => {
    expect(Activity.of(running("execute", { code: "await tools.opencode.worktree_list({})" }))).toEqual({
      text: "Listing worktree",
      kind: "tool",
    })
    expect(Activity.of(running("execute", { code: "return 1 + 1" }))).toEqual({ text: "Running code", kind: "command" })
  })

  test("a tool name that does not start with a known verb still reads as plain words", () => {
    expect(Activity.of(running("execute", { code: "await tools.notion.page_lookup({})" })).text).toBe(
      "Using page lookup",
    )
    expect(Activity.of(running("execute", { code: "await tools.slack.archive_channel({})" })).text).toBe(
      "Archiving channel",
    )
  })

  test("commands without a line read by what they do", () => {
    const line = (command: string) => Activity.of(running("shell", { command })).text
    expect(line("bun test packages/chat")).toBe("Running tests")
    expect(line("cd app && npm install")).toBe("Installing dependencies")
    expect(line("git status")).toBe("Checking the repository")
    expect(line("curl -s https://example.com")).toBe("Fetching from the web")
    expect(line("whoami")).toBe("Checking the current user")
    expect(line("sleep 20 && echo done")).toBe("Waiting 20 seconds")
    expect(line("./script.sh --fast")).toBe("Running ./script.sh --fast")
    expect(line("./deploy.sh --region us-east-1 --stage production --verbose")).toBe("Running deploy.sh")
  })

  test("built-in tools without a line name their subject", () => {
    expect(Activity.of(running("read", { filePath: "/w/src/login.ts" })).text).toBe("Reading login.ts")
    expect(Activity.of(running("websearch", { query: "SpaceX launches" })).text).toBe(
      "Searching the web for SpaceX launches",
    )
    expect(Activity.of(running("webfetch", { url: "https://docs.github.com/en/rest" })).text).toBe(
      "Reading docs.github.com",
    )
    expect(Activity.of(running("question", {})).text).toBe("Waiting for your answer")
    expect(Activity.of(done("question", {})).text).toBe("Asked for your input")
    expect(Activity.of(running("subagent", { description: "Research pricing", prompt: "…" }))).toEqual({
      text: "Research pricing",
      kind: "agent",
    })
  })
})

describe("current activity", () => {
  test("shows the newest call that runs, even when an older parallel call still runs", () => {
    const older = running("read", { filePath: "/w/a.ts" })
    const newer = running("websearch", { query: "pricing" })
    expect(Activity.current([turn([older, newer])]).text).toBe("Searching the web for pricing")
  })

  test("a call the model is still writing is thinking until its line arrives", () => {
    expect(Activity.current([turn([streaming("shell", '{"command":"ls')])])).toEqual({
      text: "Thinking",
      kind: "thinking",
    })
    expect(Activity.current([turn([streaming("shell", '{"activity":"Listing files","comm')])]).text).toBe(
      "Listing files",
    )
  })

  test("the line is the newest step Activity lists: a call stays until the next step, and thinking after it is thinking", () => {
    const read = done("read", { filePath: "notes.md", activity: "Reading the notes" })
    const thought: SessionMessage.Content = { type: "reasoning", text: "**Checking**" }
    expect(Activity.current([])).toEqual({ text: "Thinking", kind: "thinking" })
    expect(Activity.current([turn([read])])).toEqual(Activity.of(read))
    expect(Activity.current([turn([read, thought])])).toEqual({ text: "Thinking", kind: "thinking" })
    expect(Activity.current([turn([thought, read])])).toEqual(Activity.of(read))
  })

  test("writing the answer is not an activity, so the line keeps the newest step", () => {
    const read = done("read", { filePath: "notes.md", activity: "Reading the notes" })
    expect(Activity.current([turn([read, { type: "text", text: "Here" }])])).toEqual(Activity.of(read))
  })

  test("an answer that streams with nothing done before it has no line", () => {
    expect(Activity.current([turn([{ type: "text", text: "Here" }])])).toBeUndefined()
  })
})
