export * as IntakeThreads from "./intake-threads.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { IntakeThread } from "@ren/schema/intake-thread"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"

export interface Owner {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly agentId?: Agent.ID
}

export interface Chat {
  readonly sessionId: Session.ID
  readonly exists: boolean
}

export interface Interface {
  readonly claim: (
    origin: Session.Origin,
    originId: string,
    threadKey: string,
    sessionId: Session.ID,
    owner: Owner,
  ) => Effect.Effect<Chat>
  readonly take: (
    origin: Session.Origin,
    originId: string,
    threadKey: string,
    sessionId: Session.ID,
    owner: Pick<Owner, "organizationId">,
  ) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/IntakeThreads") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const thread = Database.Schema.intake_thread
    const session = Database.Schema.agent_session

    return Service.of({
      claim: Effect.fn("IntakeThreads.claim")(function* (
        origin: Session.Origin,
        originId: string,
        threadKey: string,
        sessionId: Session.ID,
        owner: Owner,
      ) {
        yield* database.db
          .insert(thread)
          .values({
            id: IntakeThread.ID.create(),
            organization_id: owner.organizationId,
            origin,
            origin_id: originId,
            thread_key: threadKey,
            current_session_id: sessionId,
          })
          .onConflictDoNothing()
          .pipe(Effect.orDie)
        const read = database.db
          .select({
            id: thread.id,
            sessionId: thread.current_session_id,
            created: session.id,
            archivedAt: session.archived_at,
            spaceId: session.space_id,
            agentId: session.agent_id,
          })
          .from(thread)
          .leftJoin(session, eq(session.id, thread.current_session_id))
          .where(and(eq(thread.origin, origin), eq(thread.origin_id, originId), eq(thread.thread_key, threadKey)))
          .pipe(
            Effect.orDie,
            Effect.flatMap((rows) =>
              Option.match(Option.fromNullishOr(rows.at(0)), {
                onNone: () => Effect.die(new Error(`The thread ${threadKey} has no row after its claim`)),
                onSome: Effect.succeed,
              }),
            ),
          )
        const claimed = yield* read
        const kept =
          !claimed.created ||
          (!claimed.archivedAt && claimed.spaceId === owner.spaceId && claimed.agentId === (owner.agentId ?? null))
        if (kept) return { sessionId: claimed.sessionId, exists: Boolean(claimed.created) }
        yield* database.db
          .update(thread)
          .set({ current_session_id: sessionId, channel_state: {}, updated_at: new Date() })
          .where(and(eq(thread.id, claimed.id), eq(thread.current_session_id, claimed.sessionId)))
          .pipe(Effect.orDie)
        const moved = yield* read
        return { sessionId: moved.sessionId, exists: Boolean(moved.created) }
      }),
      take: Effect.fn("IntakeThreads.take")(function* (
        origin: Session.Origin,
        originId: string,
        threadKey: string,
        sessionId: Session.ID,
        owner: Pick<Owner, "organizationId">,
      ) {
        yield* database.db
          .insert(thread)
          .values({
            id: IntakeThread.ID.create(),
            organization_id: owner.organizationId,
            origin,
            origin_id: originId,
            thread_key: threadKey,
            current_session_id: sessionId,
          })
          .onConflictDoUpdate({
            target: [thread.origin, thread.origin_id, thread.thread_key],
            set: {
              current_session_id: sessionId,
              channel_state: sql`case when ${thread.current_session_id} = ${sessionId} then ${thread.channel_state} else '{}'::jsonb end`,
              updated_at: new Date(),
            },
          })
          .pipe(Effect.orDie)
      }),
    })
  }),
)
