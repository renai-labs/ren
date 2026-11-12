import { expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime, Option } from "effect"
import { RenderedPage } from "../src/rendered-page.js"

const time = { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) }

const tool = (name: string, metadata: typeof SessionMessage.Json.Type): SessionMessage.Tool => ({
  type: "tool",
  id: "page",
  name,
  state: { status: "completed", input: {}, metadata, content: [{ type: "text", text: "ok" }] },
  time,
})

const running = (name: string, metadata: typeof SessionMessage.Json.Type): SessionMessage.Tool => ({
  type: "tool",
  id: "page",
  name,
  state: { status: "running", input: {}, metadata },
  time,
})

const page = { path: "chats/ses_1/pages/a.html", title: "Q3", bytes: 120 }

test("a completed html_render is a page, by its metadata", () => {
  expect(RenderedPage.of(tool("html_render", { page }))).toEqual(Option.some(page))
})

test.each([
  tool("show_file", { page }),
  running("html_render", { page }),
  tool("html_render", { page: { path: "a.html" } }),
  tool("html_render", {}),
])("anything else is not a page", (content) => {
  expect(Option.isNone(RenderedPage.of(content))).toBe(true)
})
