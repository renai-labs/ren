import { describe, expect, test } from "bun:test"
import { Permission } from "@ren/schema/permission"
import type { SessionMessage } from "@ren/schema/session/message"
import { Schema } from "effect"
import { ChatState } from "../src/chat-state.js"
import { Projection } from "../src/projection.js"
import { Working } from "../src/working.js"
import { Fixture } from "./lib/fixture.js"

const sessionID = "ses_working"

const assistant = (content: ReadonlyArray<object>, fields: object = {}) =>
  Fixture.message({
    id: "msg_b",
    type: "assistant",
    parentID: "msg_a",
    agent: "build",
    model: Fixture.model,
    content,
    time: { created: 2 },
    ...fields,
  })

const state = (
  messages: ReadonlyArray<SessionMessage.Info>,
  fields: Partial<ChatState.State> = {},
): ChatState.State => ({
  ...ChatState.empty,
  messages: { [sessionID]: messages },
  active: { [sessionID]: "running" },
  ...fields,
})

const show = (current: ChatState.State) =>
  Working.show(current, sessionID, Projection.project({ messages: ChatState.visible(current, sessionID), busy: true }))

const prompt = Fixture.user("msg_a", 1)

describe("Working", () => {
  test("shows while a running turn has no reply yet", () => {
    expect(show(state([prompt]))).toBe(true)
  })

  test("hides once the session is idle", () => {
    expect(show(state([prompt], { active: {} }))).toBe(false)
  })

  test("hides while unfinished text streams", () => {
    expect(show(state([prompt, assistant([{ id: "prt_1", type: "text", text: "Hello" }])]))).toBe(false)
  })

  test("hides while a permission waits for the member", () => {
    const request = Schema.decodeUnknownSync(Permission.Request)({
      id: "per_1",
      sessionID,
      action: "webfetch",
      resources: [],
    })
    expect(show(state([prompt], { permissions: { [sessionID]: [request] } }))).toBe(false)
  })

  test("hides while the turn runs a tool", () => {
    const tool = {
      id: "prt_2",
      type: "tool",
      name: "shell",
      state: { status: "running", input: {}, metadata: {} },
      time: { created: 2 },
    }
    expect(show(state([prompt, assistant([tool])]))).toBe(false)
  })

  test("hides while the reply waits to retry", () => {
    const retry = { attempt: 1, at: 5, error: { type: "overloaded", message: "Overloaded" } }
    expect(show(state([prompt, assistant([], { retry })]))).toBe(false)
  })
})
