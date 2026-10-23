import { describe, expect, setDefaultTimeout } from "bun:test"
import { BrainToken } from "@ren/host-api/brain-token"
import { Shared, TestToken } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import { Auth } from "@ren/schema/auth"
import { SessionMessage } from "@ren/schema/session/message"
import { OpenCodeTranscript } from "@ren/opencode-transcript/transcript"
import { Deferred, Effect, Fiber, Layer, Option, Schedule } from "effect"
import { SqlClient } from "effect/sql"
import { Access } from "../src/access.js"
import { BrainRegistry } from "../src/brain-registry.js"
import { Models } from "../src/models.js"
import { Session } from "../src/session.js"
import { SessionRunner } from "../src/session/runner.js"
import { Space } from "../src/space.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { TranscriptCodec } from "../src/transcript-codec.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()

const configured = Shared.access({ stub: Shared.apiKey("sk-configured") }, stub.url)

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed(Models.catalog(configured)),
    grant: () => Effect.succeed(configured),
  }),
)

const it = testEffect(
  Layer.mergeAll(Session.layer, Space.layer, SpaceProvisioning.layer).pipe(
    Layer.provideMerge(SessionRunner.layer),
    Layer.provideMerge(BrainRegistry.layer),
    Layer.provideMerge(TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } })),
    Layer.provideMerge(Host.layer({}, models)),
    Layer.provideMerge(models),
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Testing.layer),
  ),
)

const page = { page: 1, pageSize: 50 }

const member = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, role = "member") {
  const provisioning = yield* SpaceProvisioning.Service
  const seeded = yield* Seed.user()
  yield* Seed.member(organizationId, seeded.id, role)
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  return { userId: seeded.id, organizationId, roles: [role] }
})

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

const claims = (token: string) =>
  BrainToken.verify(
    Host.keys.map((key) => key.publicKey),
    token,
  ).pipe(Effect.map(Option.getOrUndefined))

describe("Session", () => {
  it.live(
    "a member starts a chat with its first message in a space; members of the space see it, others do not, and its access carries the member",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* member(organizationId)
        const grace = yield* member(organizationId)
        const team = yield* spaces.create(ada, { name: "Team" })
        const script = stub.script()
        const id = Session.ID.create()
        const created = yield* sessions.create(ada, {
          id,
          spaceId: team.id,
          message: { id: SessionMessage.ID.create(), text: `plan ${script.marker}` },
        })
        expect(created).toMatchObject({ id, spaceId: team.id, createdBy: ada.userId, archivedAt: null })
        expect((yield* Effect.promise(() => script.called())).text).toContain(script.marker)
        expect((yield* sessions.list(ada, { spaceId: team.id, ...page })).items.map((item) => item.id)).toEqual([id])
        expect(yield* sessions.list(grace, { spaceId: team.id, ...page })).toMatchObject({ items: [], total: 0 })
        expect((yield* sessions.list(ada, page)).items.map((item) => item.id)).toEqual([id])
        expect(yield* sessions.list(grace, page)).toMatchObject({ items: [], total: 0 })
        expect((yield* Effect.flip(sessions.get(grace, id)))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.access(grace, id)))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.create(grace, { id: Session.ID.create(), spaceId: team.id })))._tag).toBe(
          "Primitive.NotFound",
        )
        const access = yield* Host.ready(sessions.access(ada, id))
        expect(yield* claims(access.token)).toMatchObject({
          sid: id,
          scope: "client",
          sub: ada.userId,
          name: `Ada (${ada.userId.toLowerCase()}@example.com)`,
        })
        const read = yield* Effect.promise(() =>
          fetch(`${access.url}/chat/session/${id}`, { headers: { authorization: TestToken.basic(access.token) } }),
        )
        expect(read.status).toBe(200)
      }),
  )

  it.live(
    "a member lists the models a new chat may use, the chat starts with the one picked, and an unlisted one is refused",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* member(organizationId)
        const spaceId = (yield* spaces.list(ada, page)).items.at(0)?.id
        if (!spaceId) return yield* Effect.die(new Error("Ada has no space"))
        const id = Session.ID.create()
        expect(yield* sessions.models(ada, id)).toEqual([
          { id: "stub-model", providerID: "stub", name: "Stub", variants: [] },
          { id: "stub-other", providerID: "stub", name: "Stub Other", variants: [] },
        ])
        const script = stub.script()
        yield* sessions.create(ada, {
          id,
          spaceId,
          model: { providerID: "stub", id: "stub-other" },
          message: { id: SessionMessage.ID.create(), text: script.marker },
        })
        expect((yield* Effect.promise(() => script.called())).body.model).toBe("stub-other")
        const unlisted = yield* sessions
          .create(ada, {
            id: Session.ID.create(),
            spaceId,
            model: { providerID: "stub", id: "stub-other", variant: "max" },
          })
          .pipe(Effect.flip)
        expect(unlisted).toMatchObject({ _tag: "Primitive.NotFound", message: "Model not found." })
      }),
  )

  it.live("creating again with the same ID is safe for its creator and a conflict for anyone else", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* member(organizationId)
      const admin = yield* member(organizationId, "admin")
      const spaces = yield* Space.Service
      const spaceId = (yield* spaces.list(ada, page)).items.at(0)?.id
      if (!spaceId) return yield* Effect.die(new Error("Ada has no space"))
      const id = Session.ID.create()
      yield* sessions.create(ada, { id, spaceId })
      expect(yield* sessions.create(ada, { id, spaceId })).toMatchObject({ id })
      expect((yield* Effect.flip(sessions.create(admin, { id, spaceId })))._tag).toBe("Primitive.Conflict")
    }),
  )

  it.live("its creator or an admin archives a chat, which leaves the list; another member may not", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const spaces = yield* Space.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* member(organizationId)
      const grace = yield* member(organizationId)
      const admin = yield* member(organizationId, "admin")
      const general = (yield* spaces.list(ada, page)).items.at(0)
      if (!general) return yield* Effect.die(new Error("Ada has no space"))
      const first = Session.ID.create()
      const second = Session.ID.create()
      yield* sessions.create(ada, { id: first, spaceId: general.id })
      yield* sessions.create(ada, { id: second, spaceId: general.id })
      expect((yield* Effect.flip(sessions.archive(grace, first)))._tag).toBe("Primitive.Forbidden")
      expect((yield* sessions.archive(ada, first)).archivedAt).not.toBeNull()
      expect((yield* sessions.archive(admin, second)).archivedAt).not.toBeNull()
      expect((yield* sessions.list(ada, { spaceId: general.id, ...page })).items).toEqual([])
    }),
  )
  it.live(
    "typing in a new chat wakes the space's brain for a member of the space, and is not found for anyone else",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const database = yield* Database.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* member(organizationId)
        const grace = yield* member(organizationId)
        const team = yield* spaces.create(ada, { name: "Team" })
        const script = stub.script()
        yield* sessions.create(ada, {
          id: Session.ID.create(),
          spaceId: team.id,
          message: { id: SessionMessage.ID.create(), text: `plan ${script.marker}` },
        })
        yield* Effect.promise(() => script.called())
        const brain = Database.Schema.brain
        yield* database.db.update(brain).set({ phase: "resuming" }).where(eq(brain.space_id, team.id))
        yield* sessions.prepare(ada, team.id)
        const phase = database.db
          .select({ phase: brain.phase })
          .from(brain)
          .where(eq(brain.space_id, team.id))
          .pipe(Effect.map((rows) => rows.at(0)?.phase))
        expect(
          yield* phase.pipe(
            Effect.repeat({ until: (found) => found === "ready", schedule: Schedule.spaced("100 millis") }),
            Effect.timeout("30 seconds"),
          ),
        ).toBe("ready")
        expect((yield* sessions.prepare(grace, team.id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
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
