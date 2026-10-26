export * as ChannelReply from "./channel-reply.js"

import { Channel } from "@ren/schema/channel"
import type { SessionMessage } from "@ren/schema/session/message"
import { Option, Schema } from "effect"
import { ToolState } from "./tool-state.js"

const tool = "ren_channel_reply"

const decodeSent = Schema.decodeUnknownOption(Schema.fromJsonString(Channel.Sent))

export const shown = (content: SessionMessage.Tool) =>
  content.name === tool &&
  !ToolState.failed(content) &&
  (content.state.status !== "completed" || Option.isSome(decodeSent(ToolState.output(content) ?? "")))

export const of = (content: SessionMessage.Tool) => {
  const text = ToolState.input(content).text
  return {
    text: typeof text === "string" ? text : "",
    sent: Option.getOrUndefined(
      content.state.status === "completed" ? decodeSent(ToolState.output(content) ?? "") : Option.none(),
    ),
  }
}
