import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { OpenCodeRows } from "@ren/opencode-transcript/opencode-rows"
import { OpenCodeFixtures } from "@ren/opencode-transcript/testing"
import { DateTime, Effect, Exit, Option, Schema } from "effect"
import { OpenCodeStore } from "../src/session/opencode-store.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

const Texts = Schema.fromJsonString(Schema.Array(Schema.String))

type Decoded = ReturnType<typeof OpenCodeRows.message> extends Exit.Exit<infer A, unknown> ? A : never

const textOf = (info: Decoded) => {
  if (info.type === "user") return info.text
  if (info.type === "assistant") return info.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
  return null
}

describe.each(OpenCodeFixtures.recordings.map((recording) => [recording.version, recording] as const))(
  "rows recorded on OpenCode %s",
  (_, recording) => {
    const store = Effect.gen(function* () {
      const database = yield* Database.Service
      const owner = yield* Seed.owner()
      yield* Effect.forEach(recording.chats, (chat) => Seed.session(owner, { sessionId: chat.session.id }), {
        discard: true,
      })
      yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          yield* OpenCodeStore.writeMessages(
            transaction,
            recording.chats.flatMap((chat) => chat.messages),
          )
          yield* Effect.forEach(
            recording.chats,
            (chat) => OpenCodeStore.keepInbox(transaction, chat.session.id, chat.inbox),
            { discard: true },
          )
        }),
      )
      return database
    })

    it.live("what core reads from a stored message's JSON agrees with the installed OpenCode's message", () =>
      Effect.gen(function* () {
        const database = yield* store
        const read = new Map(
          (yield* database.db
            .select({ id: Database.Schema.opencode_message.id, ...OpenCodeStore.message })
            .from(Database.Schema.opencode_message)).map((row) => [row.id, row]),
        )
        for (const row of recording.chats.flatMap((chat) => chat.messages)) {
          const decoded = OpenCodeRows.message(row)
          if (Exit.isFailure(decoded)) throw new Error(`Row ${row.id} does not decode`)
          const info = decoded.value
          const sql = read.get(row.id)
          const actual: unknown = sql && {
            id: row.id,
            text: Array.isArray(textOf(info)) ? Schema.decodeUnknownSync(Texts)(sql.text) : sql.text,
            isFromChannel: sql.isFromChannel,
            errorType: sql.errorType,
            isFilesReset: sql.isFilesReset,
            createdAt: sql.createdAt === null ? null : Number(sql.createdAt),
          }
          expect(actual).toEqual({
            id: row.id,
            text: textOf(info),
            isFromChannel: info.metadata?.channel !== undefined,
            errorType: "error" in info && info.error ? info.error.type : null,
            isFilesReset: info.metadata?.source === "ren.files-reset",
            createdAt: DateTime.toEpochMillis(info.time.created),
          })
        }
      }),
    )

    it.live("a chat's files reset is its latest files-reset synthetic message or queued item", () =>
      Effect.gen(function* () {
        const database = yield* store
        for (const chat of recording.chats) {
          const times = [
            ...chat.messages.flatMap((row) => {
              const decoded = OpenCodeRows.message(row)
              return Exit.isSuccess(decoded) &&
                decoded.value.type === "synthetic" &&
                decoded.value.metadata?.source === "ren.files-reset"
                ? [DateTime.toEpochMillis(decoded.value.time.created)]
                : []
            }),
            ...chat.inbox.flatMap((row) =>
              row.type === "synthetic" && row.payload.includes("ren.files-reset") ? [row.time_created] : [],
            ),
          ]
          const actual = yield* database.transaction((transaction) =>
            OpenCodeStore.filesResetAt(transaction, chat.session.id),
          )
          expect({ id: chat.session.id, at: Option.map(actual, (at) => at.getTime()) }).toEqual({
            id: chat.session.id,
            at: times.length === 0 ? Option.none() : Option.some(Math.max(...times)),
          })
        }
        expect(recording.chats.some((chat) => chat.inbox.some((row) => row.payload.includes("ren.files-reset")))).toBe(
          true,
        )
      }),
    )
  },
)
