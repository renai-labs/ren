import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Session } from "@ren/schema/session"
import { eq, inArray } from "drizzle-orm"
import { Duration, Effect, Layer } from "effect"
import { DurableRunner } from "../src/durable-runner.js"
import { Retention } from "../src/retention.js"
import { SessionSync } from "../src/session-sync.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { SyncFixture } from "./lib/sync-fixture.js"

const it = testEffect(
  Layer.mergeAll(Retention.layer, SessionSync.layer).pipe(
    Layer.provideMerge(DurableRunner.layerMemory),
    Layer.provideMerge(Testing.layer),
  ),
)

const now = Date.now()

const daysAgo = (days: number) => new Date(now - Duration.toMillis(Duration.days(days)))

describe("Retention", () => {
  it.live(
    "a chat with no activity for 30 days goes with its subagent chats and transcript, a chat active on day 29 stays, and a row removed 31 days ago goes",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const retention = yield* Retention.Service
        const owner = yield* Seed.owner()
        const old = yield* Seed.session(owner)
        const recent = yield* Seed.session(owner)
        const child = Session.ID.create()
        const host = SyncFixture.host(owner.organizationId, old)
        yield* SyncFixture.pass(host, SyncFixture.session(old, { time_updated: daysAgo(31).getTime() }), 2, [
          SyncFixture.message(old, "msg_old", 1),
        ])
        yield* SyncFixture.pass(
          host,
          SyncFixture.session(child, { parent_id: old, time_updated: daysAgo(31).getTime() }),
          2,
          [],
        )
        yield* SyncFixture.pass(
          SyncFixture.host(owner.organizationId, recent),
          SyncFixture.session(recent, { time_updated: daysAgo(29).getTime() }),
          3,
          [
            SyncFixture.message(recent, "msg_gone", 1),
            SyncFixture.message(recent, "msg_kept", 2),
            SyncFixture.message(recent, "msg_live", 3),
          ],
        )
        yield* database.db
          .update(Database.Schema.agent_session)
          .set({ created_at: daysAgo(40) })
          .where(inArray(Database.Schema.agent_session.id, [old, child, recent]))
        yield* database.db
          .update(Database.Schema.opencode_message)
          .set({ removed_at: daysAgo(31) })
          .where(eq(Database.Schema.opencode_message.id, "msg_gone"))
        yield* database.db
          .update(Database.Schema.opencode_message)
          .set({ removed_at: daysAgo(1) })
          .where(eq(Database.Schema.opencode_message.id, "msg_kept"))
        yield* retention.run
        const chats = yield* database.db
          .select({ id: Database.Schema.agent_session.id })
          .from(Database.Schema.agent_session)
          .where(inArray(Database.Schema.agent_session.id, [old, child, recent]))
        const messages = yield* database.db
          .select({ id: Database.Schema.opencode_message.id })
          .from(Database.Schema.opencode_message)
          .where(inArray(Database.Schema.opencode_message.session_id, [old, child, recent]))
        expect([chats.map((row) => row.id), messages.map((row) => row.id).toSorted()]).toEqual([
          [recent],
          ["msg_kept", "msg_live"],
        ])
      }),
  )
})
