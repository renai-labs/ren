export * as AppConnect from "./app-connect.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Option, Schema } from "effect"
import { ToolState } from "./tool-state.js"

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ appId: Schema.String, spaceId: Schema.String })),
)

const calls = Schema.decodeUnknownOption(Schema.Array(Schema.Struct({ tool: Schema.String })))

const called = (content: SessionMessage.Tool) =>
  content.name.endsWith("_app_request_connect") ||
  (content.name === "execute" &&
    Option.exists(calls(ToolState.metadata(content).toolCalls), (list) =>
      list.some((call) => call.tool.endsWith(".app_request_connect")),
    ))

export const of = (content: SessionMessage.Tool) =>
  content.state.status === "completed" && called(content) ? decode(ToolState.output(content) ?? "") : Option.none()

export const shown = (content: SessionMessage.Tool) => Option.isSome(of(content))
