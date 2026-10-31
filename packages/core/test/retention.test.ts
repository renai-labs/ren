import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Schedule } from "@ren/schema/schedule"
import { ScheduleRun } from "@ren/schema/schedule-run"
import { Session } from "@ren/schema/session"
import { eq, inArray } from "drizzle-orm"
import { Duration, Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import { Drives } from "../src/drives.js"
import { DurableRunner } from "../src/durable-runner.js"
import { Retention } from "../src/retention.js"
import { SessionSync } from "../src/session-sync.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { SyncFixture } from "./lib/sync-fixture.js"

const it = testEffect(
  Layer.mergeAll(Retention.layer, SessionSync.layer).pipe(
    Layer.provideMerge(Drives.layer),
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(DurableRunner.layerMemory),
    Layer.provideMerge(Testing.layer),
    Layer.provide(TestDrives.layer),
  ),
)

const now = Date.now()

const daysAgo = (days: number) => new Date(now - Duration.toMillis(Duration.days(days)))

describe("Retention", () => {
  it.live(
    "a chat with no activity for 30 days goes with its subagent chats and transcript, a chat active on day 29 stays, and a row removed or a schedule run due 31 days ago goes",
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
        const scheduleId = Schedule.ID.create()
        yield* database.db.insert(Database.Schema.schedule).values({
          id: scheduleId,
          organization_id: owner.organizationId,
          space_id: owner.spaceId,
          slug: "digest",
          name: "Digest",
          owner_id: owner.createdBy,
          cron: "0 9 * * *",
          time_zone: "UTC",
          message: "Digest.",
        })
        const runs = [daysAgo(31), daysAgo(29)].map((scheduledAt) => ({
          id: ScheduleRun.ID.create(),
          schedule_id: scheduleId,
          scheduled_at: scheduledAt,
          trigger: "timed" as const,
          status: "started" as const,
          session_id: Session.ID.create(),
          message_id: Session.MessageID.create(),
        }))
        yield* database.db.insert(Database.Schema.schedule_run).values(runs)
        yield* retention.run
        const chats = yield* database.db
          .select({ id: Database.Schema.agent_session.id })
          .from(Database.Schema.agent_session)
          .where(inArray(Database.Schema.agent_session.id, [old, child, recent]))
        const messages = yield* database.db
          .select({ id: Database.Schema.opencode_message.id })
          .from(Database.Schema.opencode_message)
          .where(inArray(Database.Schema.opencode_message.session_id, [old, child, recent]))
        const kept = yield* database.db
          .select({ id: Database.Schema.schedule_run.id })
          .from(Database.Schema.schedule_run)
          .where(eq(Database.Schema.schedule_run.schedule_id, scheduleId))
        expect([
          chats.map((row) => row.id),
          messages.map((row) => row.id).toSorted(),
          kept.map((row) => row.id),
        ]).toEqual([[recent], ["msg_kept", "msg_live"], runs.slice(1).map((run) => run.id)])
      }),
  )

  it.live("a space's drive goes 30 days after the space is archived, and a space archived 29 days ago keeps it", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const drives = yield* Drives.Service
      const retention = yield* Retention.Service
      const owner = yield* Seed.owner()
      const ada = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] }
      const recent = yield* Seed.space(owner.organizationId)
      yield* Seed.join(recent, owner.createdBy)
      const spaceIds = [owner.spaceId, recent]
      yield* Effect.forEach(spaceIds, (spaceId) =>
        Effect.flatMap(drives.startUpload(ada, { spaceId, path: "notes/plan.md", size: 4 }), (upload) =>
          TestDrives.post(upload, "plan"),
        ),
      )
      yield* database.db
        .update(Database.Schema.space)
        .set({ archived_at: daysAgo(90) })
        .where(eq(Database.Schema.space.id, owner.spaceId))
      yield* database.db
        .update(Database.Schema.space)
        .set({ archived_at: daysAgo(29) })
        .where(eq(Database.Schema.space.id, recent))
      yield* retention.run
      yield* database.db
        .update(Database.Schema.space)
        .set({ archived_at: null })
        .where(inArray(Database.Schema.space.id, spaceIds))
      const folders = yield* Effect.forEach(spaceIds, (spaceId) =>
        Effect.map(drives.list(ada, { spaceId }), (listing) => listing.folders),
      )
      expect(folders).toEqual([[], ["notes"]])
    }),
  )
})
