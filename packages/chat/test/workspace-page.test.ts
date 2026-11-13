import { expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session/message"
import { DateTime, Option } from "effect"
import { WorkspacePage } from "../src/workspace-page.js"

const tool = (name: string, filePath: string, status: "completed" | "error" = "completed"): SessionMessage.Tool => ({
  type: "tool",
  id: "page",
  name,
  state:
    status === "completed"
      ? { status, input: { filePath }, content: [{ type: "text", text: "Wrote file" }] }
      : {
          status,
          input: { filePath },
          content: [{ type: "text", text: "Write failed." }],
          error: { type: "unknown", message: "Write failed." },
        },
  time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
})

test.each(["write", "edit"])("a completed %s of .ren/pages/*.html is a page, by its workspace path", (name) => {
  expect(WorkspacePage.of(tool(name, "/work/repo/.ren/pages/q3.html"))).toEqual(Option.some(".ren/pages/q3.html"))
  expect(WorkspacePage.of(tool(name, "./.ren/pages/q3.html"))).toEqual(Option.some(".ren/pages/q3.html"))
})

test.each([
  tool("write", ".ren/pages/q3.md"),
  tool("write", ".ren/pages/sub/q3.html"),
  tool("write", "docs/q3.html"),
  tool("read", ".ren/pages/q3.html"),
  tool("write", ".ren/pages/q3.html", "error"),
])("anything else is a normal tool", (content) => {
  expect(Option.isNone(WorkspacePage.of(content))).toBe(true)
})
