import { expect, setDefaultTimeout } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { testEffect } from "@ren/executor/testing"
import { OpenCodeRows } from "@ren/opencode-transcript/opencode-rows"
import { Session } from "@ren/schema/session"
import { Effect, Layer, Schema } from "effect"
import { OpenCodeImport } from "./lib/opencode-import.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(180_000)

const it = testEffect(Layer.empty)

const stub = Shared.stub()

// oxlint-disable-next-line ren/no-comments -- The restore fixture: the shape of a large chat group, with made-up content.
const fixture = { chats: 52, messages: 1_783, bytes: 24 * 1024 * 1024, largestBytes: Math.round(2.8 * 1024 * 1024) }

const restoreWithin = 60_000

const Count = Schema.Array(Schema.Struct({ count: Schema.Int }))

it.live(
  `a restore of ${fixture.chats} chats, ${fixture.messages} messages and 24 MB imports within 60 s; the import time and the longest stall are reported`,
  () =>
    Effect.gen(function* () {
      const source = yield* OpenCodeImport.open()
      yield* source.start()
      yield* OpenCodeImport.turn(source, `${stub.script().marker} first`)
      const data = yield* OpenCodeImport.exported(source.database, source.id)
      const row = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
        (yield* OpenCodeImport.all(source.database, "select * from session_v2 where id = ?", source.id)).at(0),
      )
      const children = Array.from({ length: fixture.chats - 1 }, () => SessionID.make(Session.ID.create()))
      const perChild = Math.floor(fixture.messages / fixture.chats)
      const counts = [fixture.messages - perChild * children.length, ...children.map(() => perChild)]
      const cycle = data.messages
      const plans = counts.map((count) => Array.from({ length: count }, (_, index) => cycle[index % cycle.length]))
      const users = plans.flat().filter((message) => message?.type === "user").length
      const padding = Math.floor((fixture.bytes - fixture.largestBytes) / (users - 1))
      const padded = { first: true }
      const groups = plans.map((plan, index) => ({
        info: index === 0 ? data.info : OpenCodeRows.session({ ...row, id: children[index - 1], parent_id: source.id }),
        messages: plan.flatMap((message): ReadonlyArray<SessionMessage.Info> => {
          if (!message) return []
          const id = SessionMessage.ID.create()
          if (message.type !== "user") return [{ ...message, id }]
          const size = padded.first ? fixture.largestBytes : padding
          padded.first = false
          return [{ ...message, id, text: "x".repeat(size) }]
        }),
      }))
      const target = yield* OpenCodeImport.open(source.id)
      const stall = { last: performance.now(), longestMs: 0 }
      const timer = setInterval(() => {
        const at = performance.now()
        stall.longestMs = Math.max(stall.longestMs, at - stall.last)
        stall.last = at
      }, 10)
      const started = performance.now()
      yield* Effect.forEach(
        groups,
        (group) => target.opencode.session.import({ ...group, location: group.info.location }),
        { discard: true },
      ).pipe(Effect.ensuring(Effect.sync(() => clearInterval(timer))))
      const elapsedMs = performance.now() - started
      yield* Effect.logInfo(
        `restore of ${fixture.chats} chats, ${fixture.messages} messages, 24 MB: ${Math.round(elapsedMs)} ms; longest stall ${Math.round(stall.longestMs)} ms`,
      )
      const stored = yield* Schema.decodeUnknownEffect(Count)(
        yield* OpenCodeImport.all(target.database, "select count(*) as count from session_message"),
      )
      expect(stored.at(0)?.count).toBe(fixture.messages)
      expect(elapsedMs).toBeLessThan(restoreWithin)
    }),
)
