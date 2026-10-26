import { expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"
import { ChannelReply } from "../src/channel-reply.js"

const completed = (output: string): SessionMessage.Tool => ({
  type: "tool",
  id: "reply",
  name: "slack_reply_to_current_thread",
  state: {
    status: "completed",
    input: { text: "Rolled back." },
    content: [{ type: "text", text: output }],
  },
  time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
})

test("a successful channel reply exposes the sent provider and original answer", () => {
  const tool = completed('{"provider":"slack","place":"eng"}')
  expect(ChannelReply.shown(tool)).toBe(true)
  expect(ChannelReply.of(tool)).toEqual({ text: "Rolled back.", sent: { provider: "slack", place: "eng" } })
})

test.each(["", "Complete", '{"provider":"unknown","place":"eng"}'])(
  "a completed reply with unrecognized output uses the normal tool row: %s",
  (output) => {
    expect(ChannelReply.shown(completed(output))).toBe(false)
  },
)
