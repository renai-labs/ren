export * as ChannelTurns from "./channel-turns.js"

import { Database } from "@ren/db/database"
import { Channel } from "@ren/schema/channel"
import { Session } from "@ren/schema/session"
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { Brains } from "./brains.js"
import { ChannelNotice } from "./channel-notice.js"
import { ChannelProvider } from "./channel-provider.js"
import { DurableRunner } from "./durable-runner.js"
import { SessionRunner } from "./session/runner.js"

export interface Interface {
  readonly synced: (sessionId: Session.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelTurns") {}

export const TurnRun = DurableRunner.make("ChannelTurn", {
  payload: { sessionId: Session.ID, idle: Schema.Number },
  idempotencyKey: (payload) => `${payload.sessionId}:${payload.idle}`,
})

const reminder = {
  description: "Reminder: reply in the thread",
  source: "channel",
  text: (provider: Channel.Provider, tool: string) =>
    `You have not answered in the ${Channel.titles[provider]} thread. Text in this chat is not sent there: answer the person with ${tool}.`,
}

const reasonOf = (errorType: string | null): Channel.FailureReason => {
  if (errorType === "provider.rate-limit") return "model_busy"
  if (errorType?.startsWith("compaction.")) return "context_too_long"
  return "unknown"
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const registry = yield* ChannelProvider.Registry
    const notices = yield* ChannelNotice.Service
    const runner = yield* SessionRunner.Service
    const brains = yield* Brains.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const thread = Database.Schema.channel_thread
    const opencode = Database.Schema.opencode_session
    const message = Database.Schema.opencode_message
    const session = Database.Schema.agent_session
    const reminded = new Map<Session.ID, string>()

    const latestOf = (sessionId: Session.ID, type: "user" | "assistant") =>
      database.db
        .select({
          id: message.id,
          fromChannel: sql<boolean>`(${message.data}::jsonb -> 'metadata' -> 'channel') is not null`,
          errorType: sql<string | null>`${message.data}::jsonb -> 'error' ->> 'type'`,
        })
        .from(message)
        .where(and(eq(message.session_id, sessionId), eq(message.type, type), isNull(message.removed_at)))
        .orderBy(desc(message.seq), desc(message.id))
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => Option.fromNullishOr(rows.at(0))),
        )

    const threadOf = (sessionId: Session.ID) =>
      database.db
        .select()
        .from(thread)
        .where(and(eq(thread.session_id, sessionId), isNotNull(thread.last_message_at)))
        .orderBy(desc(thread.last_message_at))
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => Option.fromNullishOr(rows.at(0))),
        )

    const targetOf = (found: typeof thread.$inferSelect): ChannelProvider.Target => ({
      install: found.install,
      place: found.place_name ?? found.thread,
      thread: found.thread,
      message: found.last_message ?? "",
    })

    const end = Effect.fnUntraced(function* (
      payload: typeof TurnRun.payloadSchema.Type,
      found: {
        readonly outcome: string | null
        readonly createdBy: Session.Sender["userId"]
        readonly latest: string
        readonly thread: typeof thread.$inferSelect
        readonly provider: ChannelProvider.Provider
      },
    ) {
      const target = targetOf(found.thread)
      const failed = found.outcome === "failed"
      yield* found.provider
        .progress(target, failed ? "failed" : "done")
        .pipe(Effect.catchCause((cause) => Effect.logWarning("A channel progress could not be sent", cause)))
      if (failed) {
        const error = yield* latestOf(payload.sessionId, "assistant")
        return yield* notices.notice({
          provider: found.thread.provider,
          target,
          reason: reasonOf(Option.match(error, { onNone: () => null, onSome: (row) => row.errorType })),
          sessionId: payload.sessionId,
        })
      }
      const sent = found.thread.last_reply_at
      const asked = found.thread.last_message_at
      const tool = found.provider.replyTool
      if (
        tool &&
        found.outcome === "succeeded" &&
        !(sent && asked && sent >= asked) &&
        reminded.get(payload.sessionId) !== found.latest
      ) {
        reminded.set(payload.sessionId, found.latest)
        yield* runner.send({
          sessionId: payload.sessionId,
          messageId: Session.MessageID.create(),
          prompt: { text: reminder.text(found.thread.provider, tool) },
          delivery: "queue",
          sender: { userId: found.createdBy },
          synthetic: { description: reminder.description, source: reminder.source },
        })
      }
    })

    const run = Effect.fnUntraced(function* (payload: typeof TurnRun.payloadSchema.Type) {
      const sessionId = payload.sessionId
      const row = (yield* database.db
        .select({ outcome: opencode.idle_outcome, createdBy: session.created_by })
        .from(opencode)
        .innerJoin(session, eq(session.id, opencode.session_id))
        .where(eq(opencode.session_id, sessionId))
        .pipe(Effect.orDie)).at(0)
      const latest = yield* latestOf(sessionId, "user")
      const current = yield* threadOf(sessionId)
      const provider = Option.flatMap(current, (found) => registry.get(found.provider))
      if (row && Option.isSome(current) && Option.isSome(provider) && Option.isSome(latest) && latest.value.fromChannel)
        yield* end(payload, {
          outcome: row.outcome,
          createdBy: row.createdBy,
          latest: latest.value.id,
          thread: current.value,
          provider: provider.value,
        })
    })

    yield* brains.onStartRejected((sessionId) =>
      Effect.gen(function* () {
        const current = yield* threadOf(sessionId)
        const provider = Option.flatMap(current, (found) => registry.get(found.provider))
        if (Option.isNone(current) || Option.isNone(provider)) return
        const target = targetOf(current.value)
        yield* provider.value
          .progress(target, "failed")
          .pipe(Effect.catchCause((cause) => Effect.logWarning("A channel progress could not be sent", cause)))
        yield* notices.notice({ provider: current.value.provider, target, reason: "brain_failed", sessionId })
      }),
    )

    yield* DurableRunner.register(TurnRun, (payload) =>
      DurableRunner.supervise(`channel-turn:${payload.sessionId}:${payload.idle}`, run(payload)),
    )

    return Service.of({
      synced: Effect.fn("ChannelTurns.synced")(function* (sessionId: Session.ID) {
        const found = (yield* database.db
          .select({
            idle: opencode.time_idle,
            suspended: opencode.time_suspended,
            parentId: session.parent_id,
          })
          .from(opencode)
          .innerJoin(session, eq(session.id, opencode.session_id))
          .where(
            and(
              eq(opencode.session_id, sessionId),
              sql`exists (select 1 from ${thread} where ${thread.session_id} = ${opencode.session_id})`,
            ),
          )
          .pipe(Effect.orDie)).at(0)
        if (!found || found.parentId || found.suspended || !found.idle) return
        yield* DurableRunner.ensure(TurnRun, { sessionId, idle: found.idle }).pipe(
          Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
          Effect.catchCause((cause) => Effect.logError(`The channel turn of ${sessionId} could not be stored`, cause)),
        )
      }),
    })
  }),
)
