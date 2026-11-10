export * as ChannelThreads from "./channel-threads.js"

import { Database } from "@ren/db/database"
import { Channel } from "@ren/schema/channel"
import type { IntakeThread } from "@ren/schema/intake-thread"
import type { Session } from "@ren/schema/session"
import { and, eq, sql } from "drizzle-orm"
import { Array, DateTime, Effect, Option, Order, Schema } from "effect"
import type { ChannelProvider } from "./channel-provider.js"

export interface Thread {
  readonly id: IntakeThread.ID
  readonly origin: Session.Origin
  readonly install: string
  readonly threadKey: string
  readonly sessionId: Session.ID
  readonly state: Channel.ThreadState
  readonly createdAt: Date
}

const decode = Schema.decodeEffect(Channel.ThreadState)

const encode = Schema.encodeSync(Channel.ThreadState)

export const latest = Effect.fn("ChannelThreads.latest")(function* (
  database: Database.Interface,
  sessionId: Session.ID,
  where: { readonly origin?: Channel.Provider; readonly install?: string } = {},
) {
  const thread = Database.Schema.intake_thread
  const rows = yield* database.db
    .select()
    .from(thread)
    .where(
      and(
        eq(thread.current_session_id, sessionId),
        where.origin ? eq(thread.origin, where.origin) : undefined,
        where.install ? eq(thread.origin_id, where.install) : undefined,
      ),
    )
    .pipe(Effect.orDie)
  const threads = yield* Effect.forEach(rows, (row) =>
    decode(row.channel_state).pipe(
      Effect.orDie,
      Effect.map((state): Thread => ({
        id: row.id,
        origin: row.origin,
        install: row.origin_id,
        threadKey: row.thread_key,
        sessionId: row.current_session_id,
        state,
        createdAt: row.created_at,
      })),
    ),
  )
  const asked = threads.filter((found) => found.state.lastMessageAt)
  return Array.isReadonlyArrayNonEmpty(asked)
    ? Option.some(
        Array.max(
          asked,
          Order.mapInput(DateTime.Order, (found: Thread) => found.state.lastMessageAt ?? DateTime.makeUnsafe(0)),
        ),
      )
    : Option.none<Thread>()
})

export const targetOf = (found: Thread): ChannelProvider.Target => ({
  install: found.install,
  place: found.state.placeName ?? found.threadKey,
  thread: found.threadKey,
  message: found.state.lastMessage ?? "",
})

export const remember = Effect.fn("ChannelThreads.remember")(function* (
  database: Database.Interface,
  event: Channel.Event,
) {
  const thread = Database.Schema.intake_thread
  const now = yield* DateTime.now
  const kept = encode({ ...(event.thread.url && { url: event.thread.url }) })
  const fresh = encode({
    placeName: event.place.name ?? event.place.id,
    lastMessage: event.message,
    lastMessageAt: now,
    ...event.data,
  })
  yield* database.db
    .update(thread)
    .set({
      channel_state: sql`${JSON.stringify(kept)}::jsonb || (${thread.channel_state} - 'slack') || ${JSON.stringify(fresh)}::jsonb`,
      updated_at: DateTime.toDateUtc(now),
    })
    .where(
      and(
        eq(thread.origin, event.provider),
        eq(thread.origin_id, event.install),
        eq(thread.thread_key, event.thread.id),
      ),
    )
    .pipe(Effect.orDie)
})

export const replied = Effect.fn("ChannelThreads.replied")(function* (
  database: Database.Interface,
  id: IntakeThread.ID,
) {
  const thread = Database.Schema.intake_thread
  const now = yield* DateTime.now
  yield* database.db
    .update(thread)
    .set({
      channel_state: sql`${thread.channel_state} || ${JSON.stringify(encode({ lastReplyAt: now }))}::jsonb`,
      updated_at: DateTime.toDateUtc(now),
    })
    .where(eq(thread.id, id))
    .pipe(Effect.orDie)
})
