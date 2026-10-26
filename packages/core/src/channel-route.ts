export * as ChannelRoute from "./channel-route.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { Space } from "@ren/schema/space"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { ChannelIdentity } from "./channel-identity.js"
import { AgentQueries } from "./agent/queries.js"
import { SpaceQueries } from "./space/queries.js"

export class Refused extends Schema.TaggedError<Refused>()("ChannelRoute.Refused", {
  reason: Schema.Literals(["unlinked", "not_member", "fallback_gone"]),
}) {}

export class Unroutable extends Schema.TaggedError<Unroutable>()("ChannelRoute.Unroutable", {
  message: Schema.String,
}) {}

export interface Route {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly agentId?: Agent.ID
  readonly senderUserId: Auth.UserID
}

export interface Interface {
  readonly resolve: (event: Channel.Event) => Effect.Effect<Route, Refused | Unroutable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelRoute") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const identity = yield* ChannelIdentity.Service
    const install = Database.Schema.channel_install
    const mapping = Database.Schema.channel_mapping
    const space = Database.Schema.space
    const agent = Database.Schema.agent

    const actsIn = (organizationId: Auth.OrganizationID, spaceId: Space.ID, userId: Auth.UserID) =>
      database.transaction((transaction) => SpaceQueries.actsIn(transaction, organizationId, spaceId, userId))

    return Service.of({
      resolve: Effect.fn("ChannelRoute.resolve")(function* (event: Channel.Event) {
        const found = (yield* database.db
          .select({
            id: install.id,
            organizationId: install.organization_id,
            installedBy: install.installed_by,
            defaultSpaceId: install.default_space_id,
          })
          .from(install)
          .where(and(eq(install.provider, event.provider), eq(install.workspace, event.install)))
          .pipe(Effect.orDie)).at(0)
        if (!found)
          return yield* new Unroutable({ message: `No organization installed ${event.provider} ${event.install}` })
        const mapped = (yield* database.db
          .select({
            spaceId: mapping.space_id,
            agentId: agent.id,
            fallback: mapping.fallback,
            fallbackUserId: mapping.fallback_user_id,
          })
          .from(mapping)
          .innerJoin(space, and(eq(space.id, mapping.space_id), isNull(space.archived_at)))
          .leftJoin(agent, and(eq(agent.id, mapping.agent_id), AgentQueries.isUsableIn(space.id, found.organizationId)))
          .where(and(eq(mapping.install_id, found.id), eq(mapping.place, event.place.id)))
          .pipe(Effect.orDie)).at(0)
        const unmapped = mapped
          ? undefined
          : (yield* database.db
              .select({ id: space.id })
              .from(space)
              .where(and(eq(space.organization_id, found.organizationId), isNull(space.archived_at)))
              .orderBy(
                sql`case when ${space.id} = ${found.defaultSpaceId} then 0 else 1 end`,
                asc(space.created_at),
                asc(space.id),
              )
              .limit(1)
              .pipe(Effect.orDie)).at(0)
        const routed =
          mapped ??
          (unmapped && { spaceId: unmapped.id, agentId: null, fallback: true, fallbackUserId: found.installedBy })
        if (!routed)
          return yield* new Unroutable({ message: `Organization ${found.organizationId} has no active space` })
        const route = (senderUserId: Auth.UserID): Route => ({
          organizationId: found.organizationId,
          spaceId: routed.spaceId,
          ...(routed.agentId && { agentId: routed.agentId }),
          senderUserId,
        })
        const sender = yield* identity.find(found.organizationId, event)
        if (Option.isSome(sender) && (yield* actsIn(found.organizationId, routed.spaceId, sender.value)))
          return route(sender.value)
        if (!routed.fallback) return yield* new Refused({ reason: Option.isSome(sender) ? "not_member" : "unlinked" })
        if (routed.fallbackUserId && (yield* actsIn(found.organizationId, routed.spaceId, routed.fallbackUserId)))
          return route(routed.fallbackUserId)
        return yield* new Refused({ reason: "fallback_gone" })
      }),
    })
  }),
)
