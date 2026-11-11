import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@opencode/schema/session-message"
import { Cause, Effect, Exit, Logger, Schema } from "effect"
import { OpenCodeRows } from "../src/opencode-rows.js"
import { OpenCodeTranscript } from "../src/transcript.js"
import { OpenCodeFixtures } from "./lib/fixtures.js"

const encode = Schema.encodeSync(SessionMessage.Info)

describe.each(OpenCodeFixtures.recordings.map((recording) => [recording.version, recording] as const))(
  "rows recorded on OpenCode %s",
  (_, recording) => {
    const messages = recording.chats.flatMap((chat) => chat.messages)

    test("each message row decodes into the installed OpenCode's message with no field lost", () => {
      for (const row of messages) {
        const decoded = OpenCodeRows.message(row)
        if (Exit.isFailure(decoded))
          throw new Error(`Row ${row.id} (${row.type}) does not decode: ${Cause.pretty(decoded.cause)}`)
        const actual: unknown = { id: row.id, message: encode(decoded.value) }
        expect(actual).toEqual({
          id: row.id,
          message: OpenCodeRows.stored(row),
        })
      }
    })

    test("the saved history has a Chat API message for each message row, in order", async () => {
      const history = await Effect.runPromise(OpenCodeTranscript.messages(messages))
      expect<ReadonlyArray<string>>(history.map((message) => message.id)).toEqual(messages.map((row) => row.id))
    })
  },
)

test("saved history leaves out a row it cannot show, logs it, and keeps the other rows", async () => {
  const row = OpenCodeFixtures.recordings
    .flatMap((recording) => recording.chats)
    .flatMap((chat) => chat.messages)
    .at(0)
  if (!row) throw new Error("No recorded message")
  const logged: Array<unknown> = []
  const history = await Effect.runPromise(
    OpenCodeTranscript.messages([{ ...row, id: "msg_broken", data: "not json" }, row]).pipe(
      Effect.provide(Logger.layer([Logger.make((options) => void logged.push(options.message))])),
    ),
  )
  expect<ReadonlyArray<string>>(history.map((message) => message.id)).toEqual([row.id])
  expect(logged).toHaveLength(1)
})

test("a stand-in for a message too large to sync decodes on restore, in the place of the message it stands for", () => {
  const row = OpenCodeFixtures.recordings
    .flatMap((recording) => recording.chats)
    .flatMap((chat) => chat.messages)
    .find((each) => each.type === "assistant")
  if (!row) throw new Error("No recorded assistant message")
  const standIn = OpenCodeRows.standIn(row)
  const decoded = OpenCodeRows.message(standIn)
  if (Exit.isFailure(decoded)) throw new Error(`The stand-in does not decode: ${Cause.pretty(decoded.cause)}`)
  expect([standIn.id, standIn.seq, decoded.value.type, "text" in decoded.value && decoded.value.text]).toEqual([
    row.id,
    row.seq,
    "synthetic",
    OpenCodeRows.tooLarge,
  ])
})
