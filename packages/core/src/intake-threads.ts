export * as IntakeThreads from "./intake-threads.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Channel } from "@ren/schema/channel"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, eq, isNull, sql } from "drizzle-orm"
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
    scope: string,
    threadKey: string,
    sessionId: Session.ID,
    owner: Owner,
  ) => Effect.Effect<Chat>
  readonly open: (origin: Session.Origin, scope: string, threadKey: string) => Effect.Effect<Option.Option<Session.ID>>
  readonly take: (
    origin: Session.Origin,
    scope: string,
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
        scope: string,
        threadKey: string,
        sessionId: Session.ID,
        owner: Owner,
      ) {
        yield* database.db
          .insert(thread)
          .values({
            id: Channel.ThreadID.create(),
            organization_id: owner.organizationId,
            origin,
            scope,
            thread: threadKey,
            session_id: sessionId,
          })
          .onConflictDoNothing()
          .pipe(Effect.orDie)
        const read = database.db
          .select({
            id: thread.id,
            sessionId: thread.session_id,
            created: session.id,
            archivedAt: session.archived_at,
            spaceId: session.space_id,
            agentId: session.agent_id,
          })
          .from(thread)
          .leftJoin(session, eq(session.id, thread.session_id))
          .where(and(eq(thread.origin, origin), eq(thread.scope, scope), eq(thread.thread, threadKey)))
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
          .set({ session_id: sessionId, last_reply_at: null, updated_at: new Date() })
          .where(and(eq(thread.id, claimed.id), eq(thread.session_id, claimed.sessionId)))
          .pipe(Effect.orDie)
        const moved = yield* read
        return { sessionId: moved.sessionId, exists: Boolean(moved.created) }
      }),
      open: Effect.fn("IntakeThreads.open")(function* (origin: Session.Origin, scope: string, threadKey: string) {
        const found = (yield* database.db
          .select({ sessionId: thread.session_id })
          .from(thread)
          .innerJoin(session, and(eq(session.id, thread.session_id), isNull(session.archived_at)))
          .where(and(eq(thread.origin, origin), eq(thread.scope, scope), eq(thread.thread, threadKey)))
          .pipe(Effect.orDie)).at(0)
        return Option.fromNullishOr(found?.sessionId)
      }),
      take: Effect.fn("IntakeThreads.take")(function* (
        origin: Session.Origin,
        scope: string,
        threadKey: string,
        sessionId: Session.ID,
        owner: Pick<Owner, "organizationId">,
      ) {
        yield* database.db
          .insert(thread)
          .values({
            id: Channel.ThreadID.create(),
            organization_id: owner.organizationId,
            origin,
            scope,
            thread: threadKey,
            session_id: sessionId,
          })
          .onConflictDoUpdate({
            target: [thread.origin, thread.scope, thread.thread],
            set: {
              session_id: sessionId,
              last_reply_at: sql`case when ${thread.session_id} = ${sessionId} then ${thread.last_reply_at} end`,
              updated_at: new Date(),
            },
          })
          .pipe(Effect.orDie)
      }),
    })
  }),
)
