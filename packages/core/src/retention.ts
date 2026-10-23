export * as Retention from "./retention.js"

import { Database } from "@ren/db/database"
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm"
import { Clock, Context, DateTime, Duration, Effect, Layer, Schedule, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { DurableRunner } from "./durable-runner.js"

export interface Interface {
  readonly run: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Retention") {}

export const keep = Duration.days(30)

const RetentionRun = DurableRunner.make("Retention", {
  payload: { day: Schema.String },
  idempotencyKey: (payload) => `retention:${payload.day}`,
})

const chats = Database.Schema.agent_session

// oxlint-disable-next-line ren/no-comments -- A chat goes 30 days after its last activity, with its subagent chats and transcript; a removed message row goes 30 days after its removal (E101, E102).
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const run = Effect.gen(function* () {
      const cutoff = new Date((yield* Clock.currentTimeMillis) - Duration.toMillis(keep))
      const stale = yield* database.db
        .select({ id: chats.id })
        .from(chats)
        .leftJoin(Database.Schema.opencode_session, eq(Database.Schema.opencode_session.session_id, chats.id))
        .where(
          and(
            isNull(chats.parent_id),
            lt(chats.created_at, cutoff),
            sql`coalesce(${Database.Schema.opencode_session.time_updated}, 0) < ${cutoff.getTime()}`,
          ),
        )
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        stale,
        (chat) => database.db.delete(chats).where(eq(chats.id, chat.id)).pipe(Effect.orDie),
        { discard: true },
      )
      yield* database.db
        .delete(Database.Schema.opencode_message)
        .where(
          and(
            isNotNull(Database.Schema.opencode_message.removed_at),
            lt(Database.Schema.opencode_message.removed_at, cutoff),
          ),
        )
        .pipe(Effect.orDie)
      if (stale.length > 0) yield* Effect.logInfo(`Retention deleted ${stale.length} chats`)
    }).pipe(Effect.withSpan("Retention.run"))

    yield* DurableRunner.register(RetentionRun, (payload) => DurableRunner.supervise(`retention:${payload.day}`, run))
    yield* Effect.gen(function* () {
      const day = DateTime.formatIsoDateUtc(yield* DateTime.now)
      yield* DurableRunner.ensure(RetentionRun, { day })
    }).pipe(
      Effect.repeat(Schedule.spaced("1 hour")),
      Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
      Effect.forkScoped,
    )

    return Service.of({ run })
  }),
)
