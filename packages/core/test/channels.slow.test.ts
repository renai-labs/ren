import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Layer } from "effect"
import { ChannelFixture } from "./lib/channel-fixture.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const onBrains = testEffect(ChannelFixture.sandboxLayer)

describe("Channels on brains", () => {
  onBrains.live("a failed brain stops the run: 👀 becomes a failure and one fixed notice links to the chat", () =>
    Effect.gen(function* () {
      const subject = yield* ChannelFixture.routed
      const database = yield* Database.Service
      const outbox = yield* ChannelFixture.Outbox
      const sessionId = yield* Seed.session(subject.owner)
      yield* database.db
        .update(Database.Schema.brain)
        .set({ phase: "failed", failures: 3, failure: "the template is broken" })
        .where(eq(Database.Schema.brain.id, Brain.ofSession(sessionId)))
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, sessionId)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      yield* ChannelFixture.settled(found)
      expect(outbox.progress).toEqual([
        { message: found.message, status: "received" },
        { message: found.message, status: "failed" },
      ])
      expect(outbox.sent).toEqual([
        {
          target: { install: found.install, place: "eng", thread: found.thread.id, message: found.message },
          text: `I couldn’t start working on your message. Please try again. [Open in Ren](${ChannelFixture.app}/sessions/${sessionId})`,
        },
      ])
    }),
  )
})

const durable = testEffect(Testing.layer)

describe("Channels across a restart", () => {
  durable.live("a run that Ren stopped mid-way runs again after Ren starts, from the run it stored", () =>
    Effect.gen(function* () {
      const subject = yield* ChannelFixture.routed
      const found = ChannelFixture.event(subject.install, {
        files: [{ url: "held", name: "log.txt", mime: "text/plain" }],
      })
      yield* Effect.scoped(
        Effect.gen(function* () {
          const ren = yield* Layer.build(ChannelFixture.durableLayer({ held: true }))
          yield* Effect.gen(function* () {
            expect(yield* ChannelFixture.receive(ChannelFixture.delivery(found))).toEqual({ status: 200 })
            yield* Effect.flatMap(ChannelFixture.Hold, (hold) => Deferred.await(hold.entered))
          }).pipe(Effect.provide(ren))
        }),
      )
      const ren = yield* Layer.build(ChannelFixture.durableLayer({ held: false }))
      const accepted = yield* ChannelFixture.accepted(1).pipe(Effect.provide(ren))
      expect(accepted).toMatchObject([{ kind: "start", prompt: { text: found.text, files: [{ name: "log.txt" }] } }])
    }),
  )
})
