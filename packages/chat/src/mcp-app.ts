export * as McpApp from "./mcp-app.js"

import { SessionMessage } from "@ren/schema/session/message"
import { Option, Schema } from "effect"
import { ToolState } from "./tool-state.js"

const decode = Schema.decodeUnknownOption(SessionMessage.McpAppView)

export const of = (content: SessionMessage.Tool): Option.Option<SessionMessage.McpAppView["app"]> =>
  content.state.status === "completed"
    ? Option.map(decode(ToolState.metadata(content)), (view) => view.app)
    : Option.none()

export const shown = (content: SessionMessage.Tool) => Option.isSome(of(content))
