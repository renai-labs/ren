export * as Settings from "./settings.js"

import { Database } from "@ren/db/database"
import type { Session } from "@ren/schema/session"
import { SessionSettings } from "@ren/schema/session/settings"
import { Settings } from "@ren/schema/settings"
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { AgentQueries } from "./agent/queries.js"

export class NotFound extends Schema.TaggedError<NotFound>()("Settings.NotFound", { message: Schema.String }) {}

export interface Interface {
  readonly read: (
    sessionId: Session.ID,
    known: SessionSettings.Known,
  ) => Effect.Effect<SessionSettings.Layers, NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Settings") {}

const decode = (settings: unknown) => Schema.decodeUnknownEffect(Settings.Info)(settings).pipe(Effect.orDie)

const changed = <A extends { readonly hash: string }>(layer: A, settings: unknown, known: string | undefined) =>
  layer.hash === known
    ? Effect.succeed(layer)
    : Effect.map(decode(settings), (decoded) => ({ ...layer, settings: decoded }))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service

    return Service.of({
      read: Effect.fn("Settings.read")(function* (sessionId: Session.ID, known: SessionSettings.Known) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const session = (yield* transaction
              .select({
                organizationId: Database.Schema.agent_session.organization_id,
                spaceId: Database.Schema.agent_session.space_id,
                agentId: Database.Schema.agent_session.agent_id,
              })
              .from(Database.Schema.agent_session)
              .where(eq(Database.Schema.agent_session.id, sessionId))).at(0)
            if (!session) return yield* new NotFound({ message: `Session ${sessionId} not found.` })
            const rows = yield* transaction
              .select({
                ownerId: Database.Schema.settings.owner_id,
                hash: Database.Schema.settings.hash,
                settings: Database.Schema.settings.settings,
              })
              .from(Database.Schema.settings)
              .where(
                inArray(Database.Schema.settings.owner_id, [
                  Database.Schema.renOwner,
                  session.organizationId,
                  session.spaceId,
                ]),
              )
            const agents = yield* transaction
              .select({
                name: Database.Schema.agent.name,
                description: Database.Schema.agent.description,
                isSubagent: Database.Schema.agent.is_subagent,
                isGlobal: sql<boolean>`${Database.Schema.agent.organization_id} is null`,
                hash: sql<string>`md5(${Database.Schema.agent.name} || E'\\n' || coalesce(${Database.Schema.agent.description}, '') || E'\\n' || ${Database.Schema.agent.is_subagent}::text || E'\\n' || coalesce(${Database.Schema.settings.hash}, ''))`,
                settings: Database.Schema.settings.settings,
              })
              .from(Database.Schema.agent)
              .leftJoin(Database.Schema.settings, eq(Database.Schema.settings.owner_id, Database.Schema.agent.id))
              .where(
                and(
                  isNull(Database.Schema.agent.archived_at),
                  or(
                    isNull(Database.Schema.agent.organization_id),
                    and(
                      eq(Database.Schema.agent.organization_id, session.organizationId),
                      AgentQueries.isInSpace(session.spaceId),
                      session.agentId
                        ? or(eq(Database.Schema.agent.is_subagent, true), eq(Database.Schema.agent.id, session.agentId))
                        : eq(Database.Schema.agent.is_subagent, true),
                    ),
                  ),
                ),
              )
              .orderBy(asc(Database.Schema.agent.name))
            const hasOwnAgent = agents.some((agent) => !agent.isGlobal && !agent.isSubagent)
            const owned = (ownerId: string, knownHash: string | undefined) => {
              const row = rows.find((each) => each.ownerId === ownerId)
              return row ? changed({ hash: row.hash }, row.settings, knownHash) : Effect.succeed({ hash: null })
            }
            return {
              ren: yield* owned(Database.Schema.renOwner, known.ren),
              organization: yield* owned(session.organizationId, known.organization),
              space: yield* owned(session.spaceId, known.space),
              agents: yield* Effect.forEach(
                agents.filter((agent) => agent.isSubagent || !agent.isGlobal || !hasOwnAgent),
                (agent) =>
                  changed(
                    {
                      name: agent.name,
                      description: agent.description,
                      isSubagent: agent.isSubagent,
                      hash: agent.hash,
                    },
                    agent.settings ?? {},
                    known.agents?.[agent.name],
                  ),
              ),
            } satisfies SessionSettings.Layers
          }),
        )
      }),
    })
  }),
)
