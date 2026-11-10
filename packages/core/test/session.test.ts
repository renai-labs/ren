import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { IntakeThread } from "@ren/schema/intake-thread"
import type { Session as SessionSchema } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import type { Space as SpaceSchema } from "@ren/schema/space"
import { Task } from "@ren/schema/task"
import { TaskLink } from "@ren/schema/task-link"
import { eq } from "drizzle-orm"
import { DateTime, Deferred, Effect, Fiber, Layer, Schedule } from "effect"
import { SqlClient, Statement } from "effect/sql"
import type { Actor } from "../src/actor.js"
import { Session } from "../src/session.js"
import { Models } from "../src/models.js"
import { Space } from "../src/space.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const it = testEffect(Configured.sessionLayer)

const picker = testEffect(
  Layer.fresh(Session.layer).pipe(
    Layer.provideMerge(
      Layer.merge(
        Configured.sessionLayer,
        Layer.effect(
          Models.Service,
          Effect.gen(function* () {
            const source = yield* Models.Service
            return Models.Service.of({
              ...source,
              catalog: (organizationId) =>
                source.catalog(organizationId).pipe(
                  Effect.map((catalog) => ({
                    endpoints: catalog.endpoints.map((endpoint) => ({
                      ...endpoint,
                      models: [
                        ...endpoint.models,
                        { id: "image", type: "image" as const, protocol: "openai-images" as const },
                      ],
                    })),
                  })),
                ),
            })
          }),
        ).pipe(Layer.provide(Configured.models)),
      ),
    ),
  ),
)

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
  picker.live("the chat model picker excludes media models on a shared endpoint", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const sessions = yield* Session.Service
      const listed = yield* sessions.models(actorOf(owner), yield* Seed.session(owner))
      expect(listed.length).toBeGreaterThan(0)
      expect(listed.some((model) => model.id === "image")).toBe(false)
    }),
  )
  it.live(
    "links lists the chat's tasks the caller can read, their pull requests and issues once each, and its threads",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const sessions = yield* Session.Service
        const owner = yield* Seed.owner()
        const id = yield* Seed.session(owner)
        const hidden = yield* Seed.space(owner.organizationId)
        yield* database.db
          .insert(Database.Schema.task_sequence)
          .values({ organization_id: owner.organizationId, prefix: "ACME", last_number: 4 })
        const task = Effect.fnUntraced(function* (
          number: number,
          spaceId: SpaceSchema.ID,
          createdIn: SessionSchema.ID | null,
          urls: ReadonlyArray<string>,
        ) {
          const taskId = Task.ID.create()
          const createdAt = new Date(Date.UTC(2026, 0, number))
          yield* database.db.insert(Database.Schema.task).values({
            id: taskId,
            organization_id: owner.organizationId,
            space_id: spaceId,
            number,
            title: `Task ${number}`,
            created_by_session_id: createdIn,
            created_at: createdAt,
          })
          if (urls.length > 0)
            yield* database.db.insert(Database.Schema.task_link).values(
              urls.map((url) => ({
                id: TaskLink.ID.create(),
                task_id: taskId,
                organization_id: owner.organizationId,
                ...TaskLink.classify(url),
                url,
                created_at: createdAt,
              })),
            )
          return taskId
        })
        const created = yield* task(1, owner.spaceId, id, [
          "https://github.com/acme/web/pull/41",
          "https://github.com/acme/web/issues/30",
        ])
        const worked = yield* task(2, owner.spaceId, null, [
          "https://github.com/Acme/Web/pull/41/files",
          "https://linear.app/acme/issue/ENG-7/login",
          "https://acme.slack.com/archives/C07/p1760000000000100",
        ])
        yield* task(3, hidden, id, ["https://github.com/acme/web/pull/99"])
        yield* task(4, owner.spaceId, null, ["https://github.com/acme/web/pull/7"])
        yield* database.db.insert(Database.Schema.task_session).values({ task_id: worked, session_id: id })
        yield* database.db.insert(Database.Schema.intake_thread).values(
          [
            { thread: "C07:1760000000.000100", url: "https://acme.slack.com/archives/C07/p1760000000000100" },
            { thread: "C07:1760000000.000200" },
          ].map((row) => ({
            id: IntakeThread.ID.create(),
            organization_id: owner.organizationId,
            origin: "slack" as const,
            origin_id: "T01",
            thread_key: row.thread,
            current_session_id: id,
            channel_state: { ...(row.url && { url: row.url }), placeName: "web-team" },
          })),
        )
        expect(yield* sessions.links(actorOf(owner), id)).toEqual({
          tasks: [
            { id: created, identifier: "ACME-1", title: "Task 1", status: "todo" },
            { id: worked, identifier: "ACME-2", title: "Task 2", status: "todo" },
          ],
          pullRequests: [{ url: "https://github.com/acme/web/pull/41", number: 41 }],
          issues: [
            { kind: "github_issue", url: "https://github.com/acme/web/issues/30" },
            { kind: "linear_issue", url: "https://linear.app/acme/issue/ENG-7/login" },
          ],
          threads: [
            { provider: "slack", url: "https://acme.slack.com/archives/C07/p1760000000000100", place: "web-team" },
          ],
        })
      }),
  )

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

  it.live("search finds a chat by its title or by the text of a person's or an assistant's message, as typed", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const owner = yield* Seed.owner()
      const titled = yield* chat(owner, "2026-01-01", {}, { title: "Quarterly plan_v2" })
      yield* chat(owner, "2026-01-01", {}, { title: "plan-v2 draft" })
      const asked = yield* chat(owner, "2026-01-02")
      const answered = yield* chat(owner, "2026-01-03")
      const removed = yield* chat(owner, "2026-01-04")
      const message = (sessionId: Session.ID, type: string, data: object) => ({
        id: SessionMessage.ID.create(),
        session_id: sessionId,
        type,
        seq: 0,
        data: JSON.stringify(data),
      })
      yield* database.db.insert(Database.Schema.opencode_message).values([
        message(asked, "user", { text: "Why did the deploy fail?" }),
        message(answered, "assistant", {
          content: [
            { type: "text", text: "The DEPLOY is fixed" },
            { type: "tool", output: "quarterly" },
          ],
        }),
        { ...message(removed, "user", { text: "deploy it" }), removed_at: new Date() },
      ])
      const actor = actorOf(owner)
      expect((yield* listed(actor, { search: "quarterly" })).ids).toEqual([titled])
      expect((yield* listed(actor, { search: "deploy" })).ids).toEqual([answered, asked])
      expect((yield* listed(actor, { search: "plan_v2" })).ids).toEqual([titled])
      expect((yield* listed(actor, { search: "plan%v2" })).ids).toEqual([])
    }),
  )

  it.live("the list reads an index for the chats of a person and of a space, and for the messages it searches", () =>
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
      expect(yield* indexes({ search: "deploy" })).toContain("opencode_message_session_id_seq_idx")
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
