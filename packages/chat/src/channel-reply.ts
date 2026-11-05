export * as ChannelReply from "./channel-reply.js"

import { Channel } from "@ren/schema/channel"
import type { SessionMessage } from "@ren/schema/session/message"
import { Option, Schema } from "effect"
import { ToolState } from "./tool-state.js"

const decodeSent = Schema.decodeUnknownOption(Schema.fromJsonString(Channel.Sent))

const answers = (content: SessionMessage.Tool) =>
  content.name.endsWith("_reply_to_current_thread") ||
  (content.name === "slack_send_message" &&
    (content.state.status === "completed" || !("channel_id" in ToolState.input(content))))

export const shown = (content: SessionMessage.Tool) =>
  answers(content) &&
  !ToolState.failed(content) &&
  (content.state.status !== "completed" || Option.isSome(decodeSent(ToolState.output(content) ?? "")))

export const of = (content: SessionMessage.Tool) => {
  const input = ToolState.input(content)
  const text = input.message ?? input.text
  return {
    text: typeof text === "string" ? text : "",
    sent: Option.getOrUndefined(
      content.state.status === "completed" ? decodeSent(ToolState.output(content) ?? "") : Option.none(),
    ),
  }
}
