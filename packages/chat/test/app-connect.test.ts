import { expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"
import { AppConnect } from "../src/app-connect.js"

const call = (output: string): SessionMessage.Tool => ({
  type: "tool",
  id: "connect",
  name: "ren_app_request_connect",
  state: { status: "completed", input: { app: "linear" }, content: [{ type: "text", text: output }] },
  time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
})

const execute = (output: string): SessionMessage.Tool => ({
  type: "tool",
  id: "execute",
  name: "execute",
  state: {
    status: "completed",
    input: { code: 'return await tools.ren.app_request_connect({ app: "linear" })' },
    metadata: { toolCalls: [{ tool: "ren.app_request_connect", status: "completed", input: { app: "linear" } }] },
    content: [{ type: "text", text: output }],
  },
  time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
})

test("a completed app_request_connect call names the app and space its card connects", () => {
  const tool = call('{"appId":"app_1","spaceId":"spc_1","profiles":[]}')
  expect(AppConnect.of(tool)).toEqual([{ appId: "app_1", spaceId: "spc_1" }])
  expect(AppConnect.shown(tool)).toBe(true)
})

test("a call whose output is not a connect card uses the normal tool row", () => {
  expect(AppConnect.shown(call("NotFoundError: App not found."))).toBe(false)
})

test("code mode: an execute call that returns app_request_connect's result shows the card", () => {
  const tool = execute('{\n  "appId": "app_1",\n  "spaceId": "spc_1",\n  "profiles": []\n}')
  expect(AppConnect.of(tool)).toEqual([{ appId: "app_1", spaceId: "spc_1" }])
})

test("code mode: an execute call that wraps app_request_connect's results shows one card for each", () => {
  const tool = execute(
    JSON.stringify({
      notion: { appId: "app_1", spaceId: "spc_1", profiles: [] },
      results: [{ content: [{ type: "text", text: '{"appId":"app_2","spaceId":"spc_1","profiles":[]}' }] }],
    }),
  )
  expect(AppConnect.of(tool)).toEqual([
    { appId: "app_1", spaceId: "spc_1" },
    { appId: "app_2", spaceId: "spc_1" },
  ])
})
