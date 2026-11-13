export * as RenderedPage from "./rendered-page.js"

import { SessionMessage } from "@ren/schema/session/message"
import { Option, Schema } from "effect"
import { ToolState } from "./tool-state.js"

const decode = Schema.decodeUnknownOption(SessionMessage.RenderedPage)

export const of = (content: SessionMessage.Tool): Option.Option<SessionMessage.RenderedPage["page"]> =>
  content.name === SessionMessage.htmlRenderTool && content.state.status === "completed"
    ? Option.map(decode(ToolState.metadata(content)), (rendered) => rendered.page)
    : Option.none()
