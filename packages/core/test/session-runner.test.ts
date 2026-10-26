import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Session } from "../src/session.js"
import { SessionRunner } from "../src/session/runner.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { SyncFixture } from "./lib/sync-fixture.js"

setDefaultTimeout(60_000)

const it = testEffect(Configured.runnerLayer)

describe("SessionRunner", () => {
  it.live("create with the ID of a session that exists fails with AlreadyExists and keeps the session", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionRunner.Service
      const owner = yield* Seed.owner()
      const sessionId = yield* Seed.session(owner, { title: "First" })
      const other = yield* Seed.owner()
      expect(
        yield* Effect.flip(sessions.create(other, { sessionId, harness: "opencode", interactive: true })),
      ).toBeInstanceOf(SessionRunner.AlreadyExists)
      expect(yield* sessions.get(sessionId)).toMatchObject({
        organizationId: owner.organizationId,
        spaceId: owner.spaceId,
        createdBy: owner.createdBy,
      })
    }),
  )

  it.live("create with a live primary agent of the space stores it on the session", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionRunner.Service
      const database = yield* Database.Service
      const owner = yield* Seed.owner()
      const agentId = yield* Seed.agent(owner, "build", { isSubagent: false })
      const sessionId = Session.ID.create()
      yield* sessions.create(owner, { sessionId, harness: "opencode", interactive: true }, { agentId })
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
        const sessions = yield* SessionRunner.Service
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
              sessions.create(owner, { sessionId, harness: "opencode", interactive: true }, { agentId }),
            ),
          ).toBeInstanceOf(SessionRunner.NotFound)
          expect(yield* Effect.flip(sessions.get(sessionId))).toBeInstanceOf(SessionRunner.NotFound)
        }
      }),
  )

  it.live(
    "get shows a session as idle with no title before a pass, then its parent and the title, status and outcome of the last pass",
    () =>
      Effect.gen(function* () {
        const sessions = yield* SessionRunner.Service
        const owner = yield* Seed.owner()
        const rootId = yield* Seed.session(owner)
        const host = SyncFixture.host(owner.organizationId, rootId)
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
})
