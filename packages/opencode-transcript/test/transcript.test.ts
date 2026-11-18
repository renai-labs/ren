import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@opencode/schema/session-message"
import { Session } from "@ren/schema/session"
import { TaskAssignment } from "@ren/schema/task-assignment"
import { Cause, Effect, Exit, Logger, Option, Schema } from "effect"
import { OpenCodeRows } from "../src/opencode-rows.js"
import { Translate } from "../src/translate.js"
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

test("a user message keeps the quotes it was sent with as presentation, and one without them shows no presentation", () => {
  const row = OpenCodeFixtures.recordings
    .flatMap((recording) => recording.chats)
    .flatMap((chat) => chat.messages)
    .find((each) => each.type === "user")
  if (!row) throw new Error("No recorded user message")
  const decoded = OpenCodeRows.message(row)
  if (Exit.isFailure(decoded) || decoded.value.type !== "user") throw new Error("The user row does not decode")
  const comments = [{ type: "quote" as const, text: "revenue is up 12%", comment: "Why?", source: "Ren's reply" }]
  const presentation = { displayText: "Why did enterprise grow?", comments }
  const sent = Translate.message({
    ...decoded.value,
    metadata: { ...decoded.value.metadata, displayText: presentation.displayText, comments },
  })
  const plain = Translate.message({ ...decoded.value, metadata: { userID: "usr_1" } })
  expect([
    Option.map(sent, (message) => message.type === "user" && message.presentation),
    Option.map(plain, (message) => message.type === "user" && message.presentation),
  ]).toEqual([Option.some(presentation), Option.some(undefined)])
})

const user = (metadata: Record<string, unknown>, text = "Look at these") =>
  Schema.decodeUnknownSync(SessionMessage.Info)({
    id: Session.MessageID.create(),
    type: "user",
    text,
    files: [
      { data: "c2hpcCBvbiBmcmlkYXk=", mime: "text/plain", source: { type: "inline" }, name: "plan.txt" },
      { data: "aGk=", mime: "text/plain", source: { type: "inline" }, name: "pasted.txt" },
    ],
    metadata: { userID: "user_1", ...metadata },
    time: { created: 1 },
  })

const plan = { path: "chats/ses_1/uploads/msg_1/plan.txt", name: "plan.txt", mime: "text/plain", size: 14 }
const report = { path: "chats/ses_1/uploads/msg_1/report.zip", name: "report.zip", mime: "application/zip", size: 9 }

test("a message that attached drive files gives them as uploads, without their bytes; a message without them keeps its files", () => {
  const attached = Option.getOrThrow(Translate.message(user({ files: [plan, report] })))
  expect(attached.type === "user" && attached.uploads).toEqual([plan, report])
  expect(attached.type === "user" && attached.files?.map((file) => file.name)).toEqual(["pasted.txt"])
  const inline = Option.getOrThrow(Translate.message(user({})))
  expect(inline.type === "user" && inline.uploads).toBeUndefined()
  expect(inline.type === "user" && inline.files?.map((file) => file.name)).toEqual(["plan.txt", "pasted.txt"])
})

const task = { taskId: "tsk_1", identifier: "REN-12", title: "Fix the login loop", brief: "It loops after sign-in." }

test("a task assignment reaches the chat as the message's task, from its metadata or, for older messages, its text", () => {
  const sent = Option.getOrThrow(Translate.message(user({ task }, TaskAssignment.text(task, "Read the task."))))
  expect(sent.type === "user" && sent.task).toEqual(task)
  const older = Option.getOrThrow(Translate.message(user({}, TaskAssignment.text(task, "Read the task."))))
  expect(older.type === "user" && older.task).toEqual(task)
  const plain = Option.getOrThrow(Translate.message(user({})))
  expect(plain.type === "user" && plain.task).toBeUndefined()
})
