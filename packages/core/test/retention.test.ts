import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Schedule } from "@ren/schema/schedule"
import { ScheduleRun } from "@ren/schema/schedule-run"
import { Session } from "@ren/schema/session"
import { eq, inArray } from "drizzle-orm"
import { Deferred, Duration, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { WorkflowEngine } from "effect/workflow"
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
    Layer.provideMerge(DurableRunner.layerEffect),
    Layer.provideMerge(Testing.layer),
    Layer.provide(TestDrives.layer),
  ),
)

const now = Date.now()

const Probe = DurableRunner.make("RetentionProbe", {
  payload: { key: Schema.String },
  idempotencyKey: (payload) => payload.key,
})

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

  it.live(
    "the rows of a durable run that ended 8 days ago go with its replies; a run that ended 6 days ago, a run still in progress and another entity's rows stay",
    () =>
      Effect.gen(function* () {
        const client = yield* SqlClient.SqlClient
        const retention = yield* Retention.Service
        const engine = yield* WorkflowEngine.WorkflowEngine
        const held = yield* Deferred.make<void>()
        const started = yield* Deferred.make<void>()
        const keys = {
          old: `old-${crypto.randomUUID()}`,
          recent: `recent-${crypto.randomUUID()}`,
          running: `running-${crypto.randomUUID()}`,
        }
        yield* DurableRunner.register(Probe, (payload) =>
          payload.key === keys.running
            ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(held)))
            : Effect.void,
        ).pipe(Effect.provideService(WorkflowEngine.WorkflowEngine, engine))
        yield* Effect.forEach([keys.old, keys.recent], (key) =>
          DurableRunner.join(Probe, { key }).pipe(Effect.provideService(WorkflowEngine.WorkflowEngine, engine)),
        )
        yield* DurableRunner.ensure(Probe, { key: keys.running }).pipe(
          Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
        )
        const idsOf = (key: string) =>
          Effect.map(
            client<{ readonly id: string }>`select id::text from cluster_messages where payload like ${`%${key}%`}`,
            (rows) => rows.map((row) => row.id),
          )
        yield* Deferred.await(started)
        const running = yield* idsOf(keys.running)
        const old = yield* idsOf(keys.old)
        const foreign = `foreign-${crypto.randomUUID()}`
        yield* client`insert into cluster_messages
          (id, rowid, message_id, shard_id, entity_type, entity_id, kind, tag, payload, headers, trace_id, span_id, sampled, processed, request_id, reply_id, last_reply_id, last_read, deliver_at)
          select id + 1000000, rowid + 1000000, message_id || '-foreign', shard_id, 'Workflow/NotRen', ${foreign}, kind, tag, payload, headers, trace_id, span_id, sampled, true, request_id, reply_id, last_reply_id, last_read, deliver_at
          from cluster_messages where id::text in ${client.in(old)}`
        yield* Effect.forEach(
          [
            [keys.old, daysAgo(8)],
            [keys.recent, daysAgo(6)],
            [keys.running, daysAgo(8)],
          ] as const,
          (entry) => client`update cluster_messages set last_read = ${entry[1]} where payload like ${`%${entry[0]}%`}`,
        )
        yield* client`update cluster_messages set last_read = ${daysAgo(8)} where entity_id = ${foreign}`
        const recent = yield* idsOf(keys.recent)
        yield* retention.run
        const left = yield* Effect.forEach([old, recent, running], (each) =>
          Effect.map(
            client<{ readonly messages: number; readonly replies: number }>`select
              (select count(*)::int from cluster_messages where id::text in ${client.in(each)}) as messages,
              (select count(*)::int from cluster_replies where request_id::text in ${client.in(each)}) as replies`,
            (rows) => rows[0],
          ),
        )
        const others = yield* client<{
          readonly count: number
        }>`select count(*)::int as count from cluster_messages where entity_id = ${foreign}`
        yield* Deferred.succeed(held, undefined)
        expect([left, others[0]?.count]).toEqual([
          [
            { messages: 0, replies: 0 },
            { messages: 1, replies: 1 },
            { messages: 1, replies: 0 },
          ],
          1,
        ])
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
        Effect.map(drives.fileSystem.list(ada, { spaceId }), (page) => page.entries.map((entry) => entry.path)),
      )
      expect(folders).toEqual([[], ["notes/"]])
    }),
  )
})
