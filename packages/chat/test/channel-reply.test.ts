import { expect, test } from "bun:test"
import type { SessionMessage } from "@ren/schema/session/message"
import { DateTime } from "effect"
import { ChannelReply } from "../src/channel-reply.js"

const completed = (
  output: string,
  name = "slack_send_message",
  input: Readonly<Record<string, string>> = { message: "Rolled back." },
): SessionMessage.Tool => ({
  type: "tool",
  id: "reply",
  name,
  state: { status: "completed", input, content: [{ type: "text", text: output }] },
  time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
})

const running = (input: Readonly<Record<string, string>>): SessionMessage.Tool => ({
  type: "tool",
  id: "reply",
  name: "slack_send_message",
  state: { status: "running", input, metadata: {} },
  time: { created: DateTime.makeUnsafe(1) },
})

test("a successful channel reply exposes the sent provider and original answer", () => {
  const tool = completed('{"provider":"slack","place":"eng","channel_id":"C07","thread_ts":"1712.33"}')
  expect(ChannelReply.shown(tool)).toBe(true)
  expect(ChannelReply.of(tool)).toEqual({ text: "Rolled back.", sent: { provider: "slack", place: "eng" } })
})

test("a reply of an earlier chat, made with slack_reply_to_current_thread, is a channel reply too", () => {
  const tool = completed('{"provider":"slack","place":"eng"}', "slack_reply_to_current_thread", {
    text: "Rolled back.",
  })
  expect(ChannelReply.shown(tool)).toBe(true)
  expect(ChannelReply.of(tool).text).toBe("Rolled back.")
})

test("a message to another channel is a normal tool, and so is one still running with a channel_id", () => {
  expect(
    ChannelReply.shown(
      completed('{"channel_id":"C09","message_ts":"1712.50"}', "slack_send_message", {
        channel_id: "C09",
        message: "Deployed.",
      }),
    ),
  ).toBe(false)
  expect(ChannelReply.shown(running({ channel_id: "C09", message: "Deployed." }))).toBe(false)
  expect(ChannelReply.shown(running({ message: "Rolled back." }))).toBe(true)
})

test.each(["", "Complete", '{"provider":"unknown","place":"eng"}'])(
  "a completed reply with unrecognized output uses the normal tool row: %s",
  (output) => {
    expect(ChannelReply.shown(completed(output))).toBe(false)
  },
)
