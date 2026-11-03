import { expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session/message"
import { DateTime, Option } from "effect"
import { AppConnect } from "../src/app-connect.js"

const call = (output: string): SessionMessage.Tool => ({
  type: "tool",
  id: "connect",
  name: "ren_app_connect",
  state: { status: "completed", input: { app: "linear" }, content: [{ type: "text", text: output }] },
  time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
})

test("a completed app_connect call names the app and space its card connects", () => {
  const tool = call('{"appId":"app_1","spaceId":"spc_1","profiles":[]}')
  expect(Option.getOrUndefined(AppConnect.of(tool))).toEqual({ appId: "app_1", spaceId: "spc_1" })
  expect(AppConnect.shown(tool)).toBe(true)
})

test("a call whose output is not a connect card uses the normal tool row", () => {
  expect(AppConnect.shown(call("NotFoundError: App not found."))).toBe(false)
})

test("code mode: an execute call that returns app_connect's result shows the card", () => {
  const tool: SessionMessage.Tool = {
    type: "tool",
    id: "execute",
    name: "execute",
    state: {
      status: "completed",
      input: { code: 'return await tools.ren.app_connect({ app: "linear" })' },
      metadata: { toolCalls: [{ tool: "ren.app_connect", status: "completed", input: { app: "linear" } }] },
      content: [{ type: "text", text: '{\n  "appId": "app_1",\n  "spaceId": "spc_1",\n  "profiles": []\n}' }],
    },
    time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
  }
  expect(Option.getOrUndefined(AppConnect.of(tool))).toEqual({ appId: "app_1", spaceId: "spc_1" })
})
