import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Shared, TestToken } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Models } from "../src/models.js"
import { Session } from "../src/session.js"
import { SessionSync } from "../src/session-sync.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"
import { Sync } from "./lib/sync.js"

const runtime = ManagedRuntime.make(Shared.layer)
beforeAll(async () => {
  settings.CELL_URL = (await runtime.runPromise(Shared.Service)).url
}, 120_000)
afterAll(() => runtime.dispose())
const stub = Shared.stub()

const configured = Shared.access({ stub: Shared.apiKey("sk-configured") })

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed(Models.catalog(configured)),
    grant: () => Effect.succeed(configured),
    refreshIfDue: () => Effect.succeedNone,
    revoke: () => Effect.void,
  }),
)

const settings = { CELL_URL: "", CELL_KEYS: TestToken.vars.CELL_KEYS }

const it = testEffect(
  Layer.unwrap(
    Effect.sync(() =>
      Layer.mergeAll(Session.layer, SessionSync.layer).pipe(
        Layer.provideMerge(Host.layer(settings, models)),
        Layer.provideMerge(Testing.layer),
      ),
    ),
  ),
)

describe("Session", () => {
  it.live("create stores a root session without its initial message and starts it on the host", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const owner = yield* Seed.owner()
      const sessionId = Session.ID.create()
      const script = stub.script()
      const start = { sessionId, harness: "opencode" as const, title: "Plan", instructions: {}, interactive: true }
      expect(
        yield* sessions.create(owner, {
          ...start,
          initialMessage: {
            messageId: Session.MessageID.create(),
            prompt: { text: `initial ${script.marker}` },
            sender: { userId: owner.createdBy },
          },
        }),
      ).toEqual({ sessionId, harness: "opencode" })
      expect((yield* Effect.promise(() => script.called())).text).toContain(script.marker)
      const rows = yield* database.db
        .select()
        .from(Database.Schema.agent_session)
        .where(eq(Database.Schema.agent_session.id, sessionId))
      expect(rows.at(0)).toMatchObject({
        parent_id: null,
        root_id: sessionId,
        start_input: start,
        sync_seq: null,
        sync_upload: 0,
      })
    }),
  )

  it.live("create with the ID of a session that exists fails with AlreadyExists and keeps the session", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const owner = yield* Seed.owner()
      const sessionId = yield* Seed.session(owner, { title: "First" })
      const other = yield* Seed.owner()
      expect(
        yield* Effect.flip(
          sessions.create(other, { sessionId, harness: "opencode", instructions: {}, interactive: true }),
        ),
      ).toBeInstanceOf(Session.AlreadyExists)
      expect(yield* sessions.get(sessionId)).toMatchObject({
        organizationId: owner.organizationId,
        spaceId: owner.spaceId,
        createdBy: owner.createdBy,
      })
    }),
  )

  it.live(
    "get shows a session as idle with no title before a pass, then its parent and the title, status and outcome of the last pass",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const owner = yield* Seed.owner()
        const rootId = yield* Seed.session(owner)
        const host = { brainId: rootId, organizationId: owner.organizationId }
        const childId = Session.ID.create()
        expect(yield* sessions.get(rootId)).toMatchObject({
          id: rootId,
          rootId,
          parentId: null,
          title: null,
          status: "idle",
          outcome: null,
          updatedAt: null,
        })
        yield* Sync.pass(host, Sync.session(rootId), 2, [])
        yield* Sync.pass(
          host,
          Sync.session(childId, { parent_id: rootId, title: "Explore", time_suspended: Sync.now + 5 }),
          3,
          [],
        )
        expect(yield* sessions.get(childId)).toMatchObject({
          rootId,
          parentId: rootId,
          title: "Explore",
          status: "busy",
        })
        yield* Sync.pass(
          host,
          Sync.session(childId, {
            parent_id: rootId,
            title: "Explore",
            idle_outcome: "completed",
            time_updated: Sync.now + 9,
          }),
          4,
          [],
        )
        const child = yield* sessions.get(childId)
        expect(child).toMatchObject({ status: "idle", outcome: "completed" })
        expect(child.updatedAt?.epochMilliseconds).toBe(Sync.now + 9)
      }),
  )

  it.live("send to a session that the host lost starts it again from its start input, then delivers", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const owner = yield* Seed.owner()
      const sessionId = yield* Seed.session(owner, { instructions: {}, interactive: true })
      const script = stub.script()
      const messageId = Session.MessageID.create()
      expect(
        yield* sessions.send({
          sessionId,
          messageId,
          prompt: { text: `again ${script.marker}` },
          delivery: "steer",
          sender: { userId: owner.createdBy },
        }),
      ).toEqual({ messageId })
      const turn = yield* Effect.promise(() => script.called())
      expect(
        turn.body.messages.filter((message) => JSON.stringify(message.content ?? "").includes(script.marker)),
      ).toHaveLength(1)
    }),
  )
})
