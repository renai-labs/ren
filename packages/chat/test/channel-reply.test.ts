import { expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"
import { ChannelReply } from "../src/channel-reply.js"

const completed = (output: string): SessionMessage.Tool => ({
  type: "tool",
  id: "reply",
  name: "ren_channel_reply",
  state: {
    status: "completed",
    input: { text: "Rolled back." },
    content: [{ type: "text", text: output }],
  },
  time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
})

test("a successful channel reply exposes the sent provider and original answer", () => {
  const tool = completed('{"provider":"github","place":"acme/api"}')
  expect(ChannelReply.shown(tool)).toBe(true)
  expect(ChannelReply.of(tool)).toEqual({ text: "Rolled back.", sent: { provider: "github", place: "acme/api" } })
})

test.each(["", "Complete", '{"provider":"unknown","place":"acme/api"}'])(
  "a completed reply with unrecognized output uses the normal tool row: %s",
  (output) => {
    expect(ChannelReply.shown(completed(output))).toBe(false)
  },
)
