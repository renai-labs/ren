import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { SessionMessage } from "@ren/schema/session/message"
import { eq } from "drizzle-orm"
import { DateTime, Deferred, Effect, Fiber, Schedule } from "effect"
import { SqlClient, Statement } from "effect/sql"
import type { Actor } from "../src/actor.js"
import { Session } from "../src/session.js"
import { Space } from "../src/space.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const it = testEffect(Configured.sessionLayer)

type ListInput = Parameters<Session.Interface["list"]>[1]

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

const chat = Effect.fnUntraced(function* (
  owner: Parameters<typeof Seed.session>[0],
  createdAt: string,
  session: Partial<typeof Database.Schema.agent_session.$inferInsert> = {},
  opencode?: Partial<typeof Database.Schema.opencode_session.$inferInsert>,
) {
  const database = yield* Database.Service
  const id = yield* Seed.session(owner)
  yield* database.db
    .update(Database.Schema.agent_session)
    .set({ created_at: new Date(createdAt), ...session })
    .where(eq(Database.Schema.agent_session.id, id))
  if (opencode)
    yield* database.db.insert(Database.Schema.opencode_session).values({
      session_id: id,
      project_id: "global",
      slug: id,
      directory: "/",
      version: "2",
      cost: 0,
      tokens_input: 0,
      tokens_output: 0,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      time_created: Date.parse(createdAt),
      time_updated: Date.parse(createdAt),
      ...opencode,
    })
  return id
})

const actorOf = (owner: { readonly organizationId: Auth.OrganizationID; readonly createdBy: Auth.UserID }) => ({
  userId: owner.createdBy,
  organizationId: owner.organizationId,
  roles: ["owner"],
})

const listed = (actor: Actor.Info, input: Partial<ListInput> = {}) =>
  Effect.flatMap(Session.Service, (sessions) => sessions.list(actor, { ...Configured.page, ...input })).pipe(
    Effect.map((page) => ({ ids: page.items.map((item) => item.id), total: page.total })),
  )

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
      expect((yield* sessions.list(ada, { spaceId: [general.id], ...Configured.page })).items).toEqual([])
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
        expect((yield* sessions.list(admin, { spaceId: [own.id], ...Configured.page })).items).toEqual([])
        expect((yield* Effect.flip(sessions.get(admin, id)))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.messages(admin, id, {})))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.archive(admin, id)))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.access(admin, id)))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.create(admin, { id: Session.ID.create(), spaceId: own.id })))._tag).toBe(
          "Primitive.NotFound",
        )
      }),
  )

  it.live(
    "a person lists their own chats by default, every member's in the spaces they name, and the chats of the people they name",
    () =>
      Effect.gen(function* () {
        const ada = yield* Seed.owner()
        const grace = { ...ada, createdBy: (yield* Seed.user()).id }
        yield* Seed.join(ada.spaceId, grace.createdBy)
        const elsewhere = { ...grace, spaceId: yield* Seed.space(ada.organizationId) }
        yield* Seed.join(elsewhere.spaceId, grace.createdBy)
        const own = yield* chat(ada, "2026-01-01")
        const shared = yield* chat(grace, "2026-01-02")
        yield* chat(elsewhere, "2026-01-03")
        expect(yield* listed(actorOf(ada))).toEqual({ ids: [own], total: 1 })
        expect((yield* listed(actorOf(ada), { spaceId: [ada.spaceId] })).ids).toEqual([shared, own])
        expect((yield* listed(actorOf(ada), { createdBy: [grace.createdBy] })).ids).toEqual([shared])
      }),
  )

  it.live("each filter of the list narrows it, two values of one filter widen it, and the total counts matches", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const agentId = yield* Seed.agent(owner, "writer", { isSubagent: false })
      const slack = yield* chat(owner, "2026-01-01", { origin: "slack", agent_id: agentId }, { time_suspended: 1 })
      const scheduled = yield* chat(owner, "2026-01-02", { origin: "schedule" })
      const archived = yield* chat(owner, "2026-01-03", { archived_at: new Date("2026-01-04") })
      const idle = yield* chat(owner, "2026-01-05", {}, {})
      const actor = actorOf(owner)
      expect(yield* listed(actor)).toEqual({ ids: [idle, scheduled, slack], total: 3 })
      expect((yield* listed(actor, { origin: ["slack", "schedule"] })).ids).toEqual([scheduled, slack])
      expect((yield* listed(actor, { agentId: [agentId] })).ids).toEqual([slack])
      expect(yield* listed(actor, { status: "busy" })).toEqual({ ids: [slack], total: 1 })
      expect((yield* listed(actor, { status: "idle" })).ids).toEqual([idle, scheduled])
      expect(yield* listed(actor, { archived: true })).toEqual({ ids: [archived], total: 1 })
    }),
  )

  it.live("the list sorts by last activity or by creation, newest first, and from and to bound that time", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const older = yield* chat(owner, "2026-01-01", {}, { time_updated: Date.parse("2026-01-10") })
      const newer = yield* chat(owner, "2026-01-05")
      const actor = actorOf(owner)
      const at = (date: string) => DateTime.makeUnsafe(date)
      expect((yield* listed(actor)).ids).toEqual([older, newer])
      expect((yield* listed(actor, { orderBy: "created" })).ids).toEqual([newer, older])
      expect((yield* listed(actor, { from: at("2026-01-07") })).ids).toEqual([older])
      expect((yield* listed(actor, { orderBy: "created", from: at("2026-01-03") })).ids).toEqual([newer])
      expect((yield* listed(actor, { orderBy: "created", to: at("2026-01-05") })).ids).toEqual([older])
    }),
  )

  it.live("the list reads an index for the chats of a person and of a space", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sql = yield* SqlClient.SqlClient
      const owner = yield* Seed.owner()
      const indexes = Effect.fnUntraced(function* (input: Partial<ListInput>) {
        const statements: Array<readonly [string, ReadonlyArray<unknown>]> = []
        yield* sessions.list(actorOf(owner), { ...Configured.page, ...input }).pipe(
          Effect.provideService(Statement.CurrentTransformer, (statement) =>
            Effect.sync(() => {
              statements.push(statement.compile())
              return statement
            }),
          ),
        )
        const plans = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`set local enable_seqscan = off`
            return yield* Effect.forEach(statements, (statement) =>
              sql.unsafe(`explain (format json) ${statement[0]}`, statement[1]),
            )
          }),
        )
        return [...JSON.stringify(plans).matchAll(/"Index Name":"(\w+)"/g)].map((match) => match[1])
      })
      expect(yield* indexes({})).toContain("agent_session_created_by_created_at_idx")
      expect(yield* indexes({ spaceId: [owner.spaceId] })).toContain("agent_session_space_id_created_at_idx")
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
