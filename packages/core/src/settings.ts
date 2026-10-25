export * as Settings from "./settings.js"

import { Database } from "@ren/db/database"
import type { Brain } from "@ren/schema/brain"
import type { Session } from "@ren/schema/session"
import { SessionSettings } from "@ren/schema/session/settings"
import { Settings } from "@ren/schema/settings"
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { AgentQueries } from "./agent/queries.js"

export class NotFound extends Schema.TaggedError<NotFound>()("Settings.NotFound", { message: Schema.String }) {}

export interface Chat {
  readonly id: Session.ID
  readonly agent: string | null
  readonly archived: boolean
}

export interface Pulled {
  readonly layers: SessionSettings.Layers
  readonly chats: ReadonlyArray<Chat>
}

export interface Interface {
  readonly pull: (brainId: Brain.ID) => Effect.Effect<Pulled, NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Settings") {}

const decode = (settings: unknown) => Schema.decodeUnknownEffect(Settings.Info)(settings).pipe(Effect.orDie)

const withSettings = <A extends { readonly hash: string }>(layer: A, settings: unknown) =>
  Effect.map(decode(settings), (decoded) => ({ ...layer, settings: decoded }))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service

    return Service.of({
      pull: Effect.fn("Settings.pull")(function* (brainId: Brain.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const brain = (yield* transaction
              .select({
                organizationId: Database.Schema.brain.organization_id,
                spaceId: Database.Schema.brain.space_id,
              })
              .from(Database.Schema.brain)
              .where(eq(Database.Schema.brain.id, brainId))).at(0)
            if (!brain) return yield* new NotFound({ message: `Brain ${brainId} not found.` })
            const sessions = yield* transaction
              .select({
                id: Database.Schema.agent_session.id,
                agentId: Database.Schema.agent_session.agent_id,
                archivedAt: Database.Schema.agent_session.archived_at,
              })
              .from(Database.Schema.agent_session)
              .where(
                and(
                  eq(Database.Schema.agent_session.brain_id, brainId),
                  isNull(Database.Schema.agent_session.parent_id),
                ),
              )
              .orderBy(asc(Database.Schema.agent_session.created_at), asc(Database.Schema.agent_session.id))
            const owned = sessions.flatMap((session) => (session.agentId ? [session.agentId] : []))
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
                  brain.organizationId,
                  brain.spaceId,
                ]),
              )
            const agents = yield* transaction
              .select({
                id: Database.Schema.agent.id,
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
                      eq(Database.Schema.agent.organization_id, brain.organizationId),
                      AgentQueries.isInSpace(brain.spaceId),
                      owned.length > 0
                        ? or(eq(Database.Schema.agent.is_subagent, true), inArray(Database.Schema.agent.id, owned))
                        : eq(Database.Schema.agent.is_subagent, true),
                    ),
                  ),
                ),
              )
              .orderBy(asc(Database.Schema.agent.name))
            const globalPrimary = agents.find((agent) => agent.isGlobal && !agent.isSubagent)
            const primaries = new Map(
              agents.flatMap((agent) => (agent.isSubagent ? [] : [[agent.id, agent.name] as const])),
            )
            const chats = sessions.map((session) => ({
              id: session.id,
              agent: (session.agentId && primaries.get(session.agentId)) ?? globalPrimary?.name ?? null,
              archived: Boolean(session.archivedAt),
            }))
            const used = new Set(chats.flatMap((chat) => (chat.agent ? [chat.agent] : [])))
            const layer = (ownerId: string) => {
              const row = rows.find((each) => each.ownerId === ownerId)
              return row ? withSettings({ hash: row.hash }, row.settings) : Effect.succeed({ hash: null })
            }
            return {
              layers: {
                ren: yield* layer(Database.Schema.renOwner),
                organization: yield* layer(brain.organizationId),
                space: yield* layer(brain.spaceId),
                agents: yield* Effect.forEach(
                  agents.filter((agent) => agent.isSubagent || used.has(agent.name)),
                  (agent) =>
                    withSettings(
                      {
                        name: agent.name,
                        description: agent.description,
                        isSubagent: agent.isSubagent,
                        hash: agent.hash,
                      },
                      agent.settings ?? {},
                    ),
                ),
              } satisfies SessionSettings.Layers,
              chats,
            }
          }),
        )
      }),
    })
  }),
)
