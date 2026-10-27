import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import { SessionMessage } from "@ren/schema/session/message"
import { Deferred, Effect, Fiber, Schedule } from "effect"
import { SqlClient } from "effect/sql"
import { Session } from "../src/session.js"
import { Space } from "../src/space.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const it = testEffect(Configured.sessionLayer)

const saved = Effect.fnUntraced(function* (texts: ReadonlyArray<string>) {
  const database = yield* Database.Service
  const owner = yield* Seed.owner()
  const id = yield* Seed.session(owner)
  yield* database.db.insert(Database.Schema.opencode_message).values(
    texts.map((text, seq) => ({
      id: SessionMessage.ID.create(),
      session_id: id,
      type: "user",
      seq,
      data: JSON.stringify({ text, time: { created: 1_760_000_000_000 } }),
    })),
  )
  return { id, actor: { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] } }
})

describe("Session", () => {
  it.live("creating again with the same ID is safe for its creator and a conflict for anyone else", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* Configured.member(organizationId)
      const admin = yield* Configured.member(organizationId, "admin")
      const spaces = yield* Space.Service
      const spaceId = (yield* spaces.list(ada, Configured.page)).items.at(0)?.id
      if (!spaceId) return yield* Effect.die(new Error("Ada has no space"))
      const id = Session.ID.create()
      yield* sessions.create(ada, { id, spaceId })
      expect(yield* sessions.create(ada, { id, spaceId })).toMatchObject({ id })
      expect((yield* Effect.flip(sessions.create(admin, { id, spaceId })))._tag).toBe("Primitive.Conflict")
    }),
  )

  it.live("any member of the space archives a chat, which leaves the list (AC7)", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const spaces = yield* Space.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* Configured.member(organizationId)
      const grace = yield* Configured.member(organizationId)
      const general = (yield* spaces.list(ada, Configured.page)).items.at(0)
      if (!general) return yield* Effect.die(new Error("Ada has no space"))
      const first = Session.ID.create()
      yield* sessions.create(ada, { id: first, spaceId: general.id })
      expect((yield* sessions.archive(grace, first)).archivedAt).not.toBeNull()
      expect((yield* sessions.list(ada, { spaceId: general.id, ...Configured.page })).items).toEqual([])
    }),
  )

  it.live(
    "an admin never lists, reads, archives or joins a chat of another person's private space (private-spaces test 3)",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* Configured.member(organizationId)
        const admin = yield* Configured.member(organizationId, "admin")
        const own = (yield* spaces.list(ada, Configured.page)).items.find((space) => space.kind === "private")
        if (!own) return yield* Effect.die(new Error("Ada has no private space"))
        const id = Session.ID.create()
        yield* sessions.create(ada, { id, spaceId: own.id })
        expect((yield* sessions.list(admin, { spaceId: own.id, ...Configured.page })).items).toEqual([])
        expect((yield* Effect.flip(sessions.get(admin, id)))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.messages(admin, id, {})))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.archive(admin, id)))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.access(admin, id)))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.create(admin, { id: Session.ID.create(), spaceId: own.id })))._tag).toBe(
          "Primitive.NotFound",
        )
      }),
  )

  it.live("Ren refuses a page of saved history over 16 MiB; a smaller page of the same chat reads", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const chat = yield* saved(["a".repeat(9 * 1024 * 1024), "b".repeat(9 * 1024 * 1024)])
      expect((yield* Effect.flip(sessions.messages(chat.actor, chat.id, { limit: 2 })))._tag).toBe(
        "Session.PageTooLarge",
      )
      expect((yield* sessions.messages(chat.actor, chat.id, { limit: 1 })).items).toHaveLength(1)
    }),
  )

  it.live(
    "Ren reads saved history 4 at a time with 16 more waiting; one more read at that moment is told to ask again",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const sql = yield* SqlClient.SqlClient
        const chat = yield* saved(["hello"])
        const locked = yield* Deferred.make<void>()
        const unlock = yield* Deferred.make<void>()
        yield* sql
          .withTransaction(
            sql`lock table opencode_message in access exclusive mode`.pipe(
              Effect.andThen(Deferred.succeed(locked, undefined)),
              Effect.andThen(Deferred.await(unlock)),
            ),
          )
          .pipe(Effect.forkScoped)
        yield* Deferred.await(locked)
        const reads = yield* Effect.all(
          Array.from({ length: 20 }, () => sessions.messages(chat.actor, chat.id, {})),
          { concurrency: "unbounded" },
        ).pipe(Effect.forkScoped)
        const blocked = sql<{ readonly count: number }>`
          select count(*)::int as count from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and query like '%opencode_message%'`.pipe(
          Effect.map((rows) => rows.at(0)?.count ?? 0),
        )
        yield* blocked.pipe(Effect.repeat({ until: (count) => count >= 4, schedule: Schedule.spaced("10 millis") }))
        expect((yield* Effect.flip(sessions.messages(chat.actor, chat.id, {})))._tag).toBe("Session.Busy")
        expect(yield* blocked).toBe(4)
        yield* Deferred.succeed(unlock, undefined)
        expect((yield* Fiber.join(reads)).map((page) => page.items.length)).toEqual(Array.from({ length: 20 }, () => 1))
      }),
  )
})
