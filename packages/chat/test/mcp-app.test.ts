import { expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime, Option } from "effect"
import { McpApp } from "../src/mcp-app.js"

const time = { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) }

const tool = (name: string, metadata: typeof SessionMessage.Json.Type): SessionMessage.Tool => ({
  type: "tool",
  id: "call",
  name,
  state: { status: "completed", input: {}, metadata, content: [{ type: "text", text: "ok" }] },
  time,
})

const app = {
  server: "linear",
  tool: "create_issue",
  resourceUri: "ui://linear/issue",
  path: "chats/ses_1/apps/a.html",
  domains: { connect: ["https://api.linear.app"], resource: [] },
  readOnly: false,
}

test("a completed MCP tool part is a view, by its metadata", () => {
  expect(McpApp.of(tool("linear_create_issue", { app }))).toEqual(Option.some(app))
})

test.each([
  tool("linear_create_issue", {}),
  tool("linear_create_issue", { app: { server: "linear" } }),
  {
    ...tool("linear_create_issue", { app }),
    state: { status: "running" as const, input: {}, metadata: { app } },
  },
])("anything else is not a view", (content) => {
  expect(Option.isNone(McpApp.of(content))).toBe(true)
})
