import { describe, expect } from "bun:test"
import { PgClient } from "@effect/sql-pg"
import type { SqlError } from "effect/sql/SqlError"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { AgentMembership } from "@ren/schema/agent-membership"
import { Brain } from "@ren/schema/brain"
import { eq } from "drizzle-orm"
import { Effect, Layer, Queue, Ref, Schedule } from "effect"
import { BrainHost } from "../src/brain-host.js"
import { BrainPush } from "../src/brain-push.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

const barrier = "barrier"

// oxlint-disable-next-line ren/no-comments -- Postgres delivers notifications in commit order, so the scopes before the barrier are all that the writes sent.
const listening = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient
  const notifications = yield* pg.listen(BrainPush.channel)
  const until = (seen: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, SqlError> =>
    Queue.take(notifications).pipe(
      Effect.flatMap((next) => (next.payload === barrier ? Effect.succeed(seen) : until([...seen, next.payload]))),
    )
  const collect = pg.notify(BrainPush.channel, barrier).pipe(Effect.andThen(until([])), Effect.orDie)
  return { collect }
})

describe("ren_notify_brains (HR10, HR23)", () => {
  it.live("only a commit notifies, with the scope of the row", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const listener = yield* listening
      const owner = yield* Seed.owner()
      yield* listener.collect
      yield* database.db.insert(Database.Schema.settings).values({ space_id: owner.spaceId, settings: {} })
      yield* database
        .transaction((transaction) =>
          transaction
            .insert(Database.Schema.settings)
            .values({ organization_id: owner.organizationId, settings: {} })
            .pipe(Effect.andThen(Effect.fail("roll back"))),
        )
        .pipe(Effect.ignore)
      yield* database.db
        .update(Database.Schema.settings)
        .set({ settings: { instructions: "Ren" } })
        .where(eq(Database.Schema.settings.owner_id, Database.Schema.renOwner))
      yield* database.db.insert(Database.Schema.settings).values({ settings: {} }).onConflictDoNothing()
      expect(yield* listener.collect).toEqual([`space:${owner.spaceId}`, "all"])
    }),
  )

  it.live(
    "sync writes to a chat send nothing; archive, agent change, delete and a cascading space delete each send one",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const listener = yield* listening
        const owner = yield* Seed.owner()
        const chat = yield* Seed.session(owner)
        const agent = yield* Seed.agent(owner, "build", { isSubagent: false })
        yield* listener.collect
        const chats = Database.Schema.agent_session
        yield* database.db.update(chats).set({ sync_seq: 7, harness_version: "2.0.27" }).where(eq(chats.id, chat))
        expect(yield* listener.collect).toEqual([])
        const scope = `space:${owner.spaceId}`
        yield* database.db.update(chats).set({ archived_at: new Date() }).where(eq(chats.id, chat))
        expect(yield* listener.collect).toEqual([scope])
        yield* database.db.update(chats).set({ agent_id: agent }).where(eq(chats.id, chat))
        expect(yield* listener.collect).toEqual([scope])
        yield* database.db.update(chats).set({ agent_id: agent }).where(eq(chats.id, chat))
        expect(yield* listener.collect).toEqual([])
        yield* database.db.delete(chats).where(eq(chats.id, chat))
        expect(yield* listener.collect).toEqual([scope])
        yield* Seed.session(owner)
        yield* listener.collect
        yield* database.db.delete(Database.Schema.space).where(eq(Database.Schema.space.id, owner.spaceId))
        expect((yield* listener.collect).filter((each) => each === scope).length).toBeGreaterThan(0)
      }),
  )

  it.live("one transaction that writes 1000 rows of one space sends one notification", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const listener = yield* listening
      const owner = yield* Seed.owner()
      const agents = yield* Effect.forEach(
        Array.from({ length: 1000 }, (_, index) => index),
        (index) => Seed.agent(owner, `agent-${index}`, { isSubagent: true }),
      )
      yield* listener.collect
      yield* database.transaction((transaction) =>
        transaction
          .insert(Database.Schema.agent_membership)
          .values(
            agents.map((agentId) => ({ id: AgentMembership.ID.create(), space_id: owner.spaceId, agent_id: agentId })),
          ),
      )
      expect(yield* listener.collect).toEqual([`space:${owner.spaceId}`])
    }),
  )
})

describe("BrainPush (HR10, HR12)", () => {
  it.live("a notified scope reaches each of its brains, and the listener listens again after a lost connection", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const notified = yield* Queue.unbounded<Brain.ID>()
      const host = Layer.succeed(
        BrainHost.Service,
        BrainHost.Service.of({
          notify: (brainId) => Queue.offer(notified, brainId).pipe(Effect.asVoid),
          target: () => Effect.die(new Error("a push reads no target")),
          access: () => Effect.die(new Error("a push never resumes a brain")),
          ensure: () => Effect.die(new Error("a push never resumes a brain")),
          observe: () => Effect.void,
          hand: () => Effect.succeedNone,
          unavailable: () => Effect.void,
          retry: () => Effect.void,
        }),
      )
      const owner = yield* Seed.owner()
      const space = Brain.ID.create()
      yield* Seed.session({ ...owner, brainId: space })
      const brains = [space, Brain.ofSession(yield* Seed.session(owner))]
      const other = yield* Seed.owner()
      yield* Seed.session(other)
      yield* Layer.build(BrainPush.layer.pipe(Layer.provide(host)))
      const write = (instructions: string) =>
        database.db
          .insert(Database.Schema.settings)
          .values({ space_id: owner.spaceId, settings: { instructions } })
          .onConflictDoUpdate({ target: Database.Schema.settings.owner_id, set: { settings: { instructions } } })
      const pushedAll = Effect.gen(function* () {
        const seen = new Set<Brain.ID>()
        while (seen.size < brains.length) seen.add(yield* Queue.take(notified))
        return [...seen].toSorted()
      })
      const pg = yield* PgClient.PgClient
      const listeners = pg`select pid from pg_stat_activity where query like 'LISTEN %'`.pipe(Effect.orDie)
      yield* listeners.pipe(Effect.repeat({ until: (rows) => rows.length > 0, schedule: Schedule.spaced("20 millis") }))
      yield* write("first")
      expect(yield* pushedAll).toEqual(brains.toSorted())
      const terminated = yield* Ref.make(0)
      yield* pg`select pg_terminate_backend(pid) from pg_stat_activity where query like 'LISTEN %'`.pipe(
        Effect.orDie,
        Effect.tap((rows) => Ref.set(terminated, rows.length)),
      )
      expect(yield* Ref.get(terminated)).toBeGreaterThan(0)
      yield* write("second").pipe(
        Effect.andThen(Queue.take(notified).pipe(Effect.timeoutOption("200 millis"))),
        Effect.repeat({ until: (pushed) => pushed._tag === "Some", schedule: Schedule.spaced("100 millis") }),
        Effect.timeout("10 seconds"),
      )
    }),
  )
})
