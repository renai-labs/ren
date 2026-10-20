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
import { SyncFixture } from "./lib/sync-fixture.js"

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

  it.live("create with a live primary agent of the space stores it on the session", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const owner = yield* Seed.owner()
      const agentId = yield* Seed.agent(owner, "build", { isSubagent: false })
      const sessionId = Session.ID.create()
      yield* sessions.create(
        owner,
        { sessionId, harness: "opencode", instructions: {}, interactive: true },
        { agentId },
      )
      const rows = yield* database.db
        .select({ agentId: Database.Schema.agent_session.agent_id })
        .from(Database.Schema.agent_session)
        .where(eq(Database.Schema.agent_session.id, sessionId))
      expect(rows).toEqual([{ agentId }])
    }),
  )

  it.live(
    "create with a subagent, an archived agent or another space's agent fails with NotFound and stores no session",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const database = yield* Database.Service
        const owner = yield* Seed.owner()
        const elsewhere = { organizationId: owner.organizationId, spaceId: yield* Seed.space(owner.organizationId) }
        const archived = yield* Seed.agent(owner, "archived", { isSubagent: false })
        yield* database.db
          .update(Database.Schema.agent)
          .set({ archived_at: new Date() })
          .where(eq(Database.Schema.agent.id, archived))
        const agents = [
          yield* Seed.agent(owner, "reviewer", { isSubagent: true }),
          archived,
          yield* Seed.agent(elsewhere, "visiting", { isSubagent: false }),
        ]
        for (const agentId of agents) {
          const sessionId = Session.ID.create()
          expect(
            yield* Effect.flip(
              sessions.create(
                owner,
                { sessionId, harness: "opencode", instructions: {}, interactive: true },
                { agentId },
              ),
            ),
          ).toBeInstanceOf(Session.NotFound)
          expect(yield* Effect.flip(sessions.get(sessionId))).toBeInstanceOf(Session.NotFound)
        }
      }),
  )

  it.live(
    "get shows a session as idle with no title before a pass, then its parent and the title, status and outcome of the last pass",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const owner = yield* Seed.owner()
        const rootId = yield* Seed.session(owner)
        const host = { sessionId: rootId, organizationId: owner.organizationId }
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
        yield* SyncFixture.pass(host, SyncFixture.session(rootId), 2, [])
        yield* SyncFixture.pass(
          host,
          SyncFixture.session(childId, { parent_id: rootId, title: "Explore", time_suspended: SyncFixture.now + 5 }),
          3,
          [],
        )
        expect(yield* sessions.get(childId)).toMatchObject({
          rootId,
          parentId: rootId,
          title: "Explore",
          status: "busy",
        })
        yield* SyncFixture.pass(
          host,
          SyncFixture.session(childId, {
            parent_id: rootId,
            title: "Explore",
            idle_outcome: "completed",
            time_updated: SyncFixture.now + 9,
          }),
          4,
          [],
        )
        const child = yield* sessions.get(childId)
        expect(child).toMatchObject({ status: "idle", outcome: "completed" })
        expect(child.updatedAt?.epochMilliseconds).toBe(SyncFixture.now + 9)
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
