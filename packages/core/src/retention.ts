export * as Retention from "./retention.js"

import { OpenCodeStore } from "./session/opencode-store.js"
import { Database } from "@ren/db/database"
import { and, eq, isNull, lt, sql } from "drizzle-orm"
import { Clock, Context, DateTime, Duration, Effect, Layer, Schedule, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { WorkflowEngine } from "effect/workflow"
import { Drives } from "./drives.js"
import { DurableRunner } from "./durable-runner.js"

export interface Interface {
  readonly run: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Retention") {}

export const keep = Duration.days(30)

export const keepRuns = Duration.days(7)

const RetentionRun = DurableRunner.make("Retention", {
  payload: { day: Schema.String },
  idempotencyKey: (payload) => `retention:${payload.day}`,
})

const chats = Database.Schema.agent_session

// oxlint-disable-next-line ren/no-comments -- A chat goes 30 days after its last activity, with its subagent chats and transcript; a removed message row goes 30 days after its removal (E101, E102); a schedule run goes 30 days after its time (schedules S18); the rows of a durable run go 7 days after it ended.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const drives = yield* Drives.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const client = yield* SqlClient.SqlClient
    const run = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const cutoff = new Date(now - Duration.toMillis(keep))
      const stale = yield* database.db
        .select({ id: chats.id })
        .from(chats)
        .leftJoin(OpenCodeStore.chat, OpenCodeStore.join)
        .where(
          and(
            isNull(chats.parent_id),
            lt(chats.created_at, cutoff),
            sql`coalesce(${OpenCodeStore.state.updatedAt}, 0) < ${cutoff.getTime()}`,
          ),
        )
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        stale,
        (chat) =>
          database
            .transaction((transaction) =>
              Effect.gen(function* () {
                yield* transaction
                  .delete(Database.Schema.intake_thread)
                  .where(eq(Database.Schema.intake_thread.current_session_id, chat.id))
                yield* transaction.delete(chats).where(eq(chats.id, chat.id))
              }),
            )
            .pipe(Effect.orDie),
        { discard: true },
      )
      yield* OpenCodeStore.purgeRemoved(database.db, cutoff)
      yield* database.db
        .delete(Database.Schema.schedule_run)
        .where(lt(Database.Schema.schedule_run.scheduled_at, cutoff))
        .pipe(Effect.orDie)
      yield* database.db
        .delete(Database.Schema.webhook_request)
        .where(lt(Database.Schema.webhook_request.received_at, cutoff))
        .pipe(Effect.orDie)
      yield* drives.sweep(cutoff)
      const runs = yield* DurableRunner.purge(client, new Date(now - Duration.toMillis(keepRuns))).pipe(Effect.orDie)
      if (stale.length > 0) yield* Effect.logInfo(`Retention deleted ${stale.length} chats`)
      if (runs > 0) yield* Effect.logInfo(`Retention deleted ${runs} durable run messages`)
    }).pipe(Effect.withSpan("Retention.run"))

    yield* DurableRunner.register(RetentionRun, (payload) => DurableRunner.supervise(`retention:${payload.day}`, run))
    yield* Effect.gen(function* () {
      const day = DateTime.formatIsoDateUtc(yield* DateTime.now)
      yield* DurableRunner.ensure(RetentionRun, { day })
    }).pipe(
      Effect.repeat(Schedule.spaced("1 hour")),
      Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
      Effect.withErrorReporting,
      Effect.forkScoped,
    )

    return Service.of({ run })
  }),
)
