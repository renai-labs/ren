import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { Label } from "../src/label.js"
import { Task } from "../src/task.js"
import { TaskLink } from "../src/task-link.js"

describe("TaskLink.classify", () => {
  test.each([
    ["https://github.com/RenAI-Labs/Ren/pull/012", "github_pr", "renai-labs/ren#12"],
    ["https://GitHub.com/renai-labs/ren/pull/12/files", "github_pr", "renai-labs/ren#12"],
    ["https://linear.app/RenAI/issue/ren-1442/tasks", "linear_issue", "renai/REN-1442"],
    ["https://renai.slack.com/archives/c0123/p1712345678123456", "slack_thread", "C0123:1712345678.123456"],
    [
      "https://renai.slack.com/archives/C0123/p1799999999000000?thread_ts=1712345678.123456",
      "slack_thread",
      "C0123:1712345678.123456",
    ],
    ["https://example.com/a?b=c", "url", "https://example.com/a?b=c"],
    ["https://github.com/RenAI-Labs/Ren/issues/012#issuecomment-1", "github_issue", "renai-labs/ren#12"],
    ["/files/report.md", "url", "/files/report.md"],
  ] as const)("%s is %s %s", (url, kind, key) => {
    expect(TaskLink.classify(url)).toEqual({ kind, key })
  })
})

describe("TaskLink.Url", () => {
  test.each(["https://example.com", "http://localhost:3000/x", "/files/report.md"])("accepts %s", (url) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(TaskLink.Url)(url))).toBe(true)
  })

  test.each(["//evil.example", "/\\evil.example", "files/report.md", "", "not a url"])("rejects %s", (url) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(TaskLink.Url)(url))).toBe(false)
  })
})

describe("Label names", () => {
  test("a label name is trimmed", () => {
    expect(Schema.decodeUnknownSync(Label.CreateInput)({ name: "  bug  " }).name).toBe("bug")
  })

  test.each(["ren-fix", "REN-improve", "ren-other"])("a new label cannot be named %s", (name) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Label.CreateInput)({ name }))).toBe(false)
  })

  test.each(["ren-fix", "REN-improve", "bug"])("a task can carry %s", (name) => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Task.LabelName)(name))).toBe(true)
  })

  test("a task cannot carry another ren- label", () => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Task.LabelName)("ren-other"))).toBe(false)
  })

  test("a color is kept in lower case", () => {
    expect(Schema.decodeUnknownSync(Label.CreateInput)({ name: "bug", color: "#D45F5F" }).color).toBe("#d45f5f")
  })
})

describe("Task.ReviewInput", () => {
  test("a request for changes says what to change", () => {
    expect(
      Exit.isSuccess(
        Schema.decodeUnknownExit(Task.ReviewInput)({ humanReview: false, decision: "changes_requested", comment: " " }),
      ),
    ).toBe(false)
  })

  test("an approval needs no comment", () => {
    expect(
      Exit.isSuccess(Schema.decodeUnknownExit(Task.ReviewInput)({ humanReview: false, decision: "approved" })),
    ).toBe(true)
  })
})

describe("Task.AssignInput", () => {
  test("needs an agent or an owner", () => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Task.AssignInput)({ note: "build it" }))).toBe(false)
  })

  test("accepts null to clear the agent", () => {
    expect(Exit.isSuccess(Schema.decodeUnknownExit(Task.AssignInput)({ agentId: null }))).toBe(true)
  })
})
