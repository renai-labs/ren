export * as ShownFile from "./shown-file.js"

import { SessionMessage } from "@ren/schema/session/message"
import { Option, Schema } from "effect"
import { ToolState } from "./tool-state.js"

const decode = Schema.decodeUnknownOption(SessionMessage.ShownFile)

export const of = (content: SessionMessage.Tool): Option.Option<SessionMessage.DriveFile> =>
  content.name === SessionMessage.showFileTool && content.state.status === "completed"
    ? Option.map(decode(ToolState.metadata(content)), (shown) => shown.file)
    : Option.none()

export const shown = (content: SessionMessage.Tool) => Option.isSome(of(content))
