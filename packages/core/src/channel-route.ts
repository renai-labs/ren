export * as ChannelRoute from "./channel-route.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import type { Task } from "@ren/schema/task"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Access } from "./access.js"
import { ChannelIdentity } from "./channel-identity.js"
import { ChannelProvider } from "./channel-provider.js"
import { AgentQueries } from "./agent/queries.js"
import { SpacePolicy } from "./space/policy.js"
import { TaskQueries } from "./task/queries.js"

export class Refused extends Schema.TaggedError<Refused>()("ChannelRoute.Refused", {
  reason: Schema.Literals(["unlinked", "not_member", "fallback_gone"]),
}) {}

export class Unroutable extends Schema.TaggedError<Unroutable>()("ChannelRoute.Unroutable", {
  message: Schema.String,
}) {}

export class NotTriggered extends Schema.TaggedError<NotTriggered>()("ChannelRoute.NotTriggered", {
  message: Schema.String,
}) {}

export interface Route {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly agentId?: Agent.ID
  readonly senderUserId: Auth.UserID
  readonly text: string
  readonly task?:
    | {
        readonly id: Task.ID
        readonly agentId: Agent.ID
        readonly isGlobal: boolean
        readonly title: string
        readonly description: string | null
        readonly sessionId?: Session.ID
      }
    | undefined
}

export interface Interface {
  readonly resolve: (event: Channel.Event) => Effect.Effect<Route, Refused | Unroutable | NotTriggered>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelRoute") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const identity = yield* ChannelIdentity.Service
    const registry = yield* ChannelProvider.Registry
    const access = yield* Access.Service
    const install = Database.Schema.channel_install
    const mapping = Database.Schema.channel_mapping
    const space = Database.Schema.space
    const agent = Database.Schema.agent

    const actsIn = (organizationId: Auth.OrganizationID, spaceId: Space.ID, userId: Auth.UserID) =>
      database.transaction((transaction) => SpacePolicy.actsIn(transaction, access, organizationId, spaceId, userId))

    const runAs = Effect.fnUntraced(function* (
      organizationId: Auth.OrganizationID,
      routed: { readonly spaceId: Space.ID; readonly fallback: boolean; readonly fallbackUserId: Auth.UserID | null },
      event: Channel.Event,
    ) {
      const sender = yield* identity.find(organizationId, event)
      if (Option.isSome(sender) && (yield* actsIn(organizationId, routed.spaceId, sender.value))) return sender.value
      if (!routed.fallback) return yield* new Refused({ reason: Option.isSome(sender) ? "not_member" : "unlinked" })
      if (routed.fallbackUserId && (yield* actsIn(organizationId, routed.spaceId, routed.fallbackUserId)))
        return routed.fallbackUserId
      return yield* new Refused({ reason: "fallback_gone" })
    })

    const taskOf = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, event: Channel.Event) {
      const link = Option.flatMap(registry.get(event.provider), (provider) => provider.linkOf(event))
      if (event.trigger || Option.isNone(link)) return
      return Option.getOrUndefined(
        yield* database.transaction((transaction) => TaskQueries.openByLink(transaction, organizationId, link.value)),
      )
    })

    const unmapped = (installedBy: Auth.UserID | null, event: Channel.Event, task: Route["task"]) => ({
      fallback: !task && !event.place.anyoneCanWrite,
      fallbackUserId: installedBy,
    })

    const defaultSpace = (found: {
      readonly organizationId: Auth.OrganizationID
      readonly defaultSpaceId: Space.ID | null
    }) =>
      database.db
        .select({ spaceId: space.id })
        .from(space)
        .where(and(eq(space.organization_id, found.organizationId), isNull(space.archived_at)))
        .orderBy(
          sql`case when ${space.id} = ${found.defaultSpaceId} then 0 else 1 end`,
          asc(space.created_at),
          asc(space.id),
        )
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map((row) => ({ spaceId: row.spaceId, agentId: null })).at(0)),
        )

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
            triggers: mapping.triggers,
          })
          .from(mapping)
          .innerJoin(space, and(eq(space.id, mapping.space_id), isNull(space.archived_at)))
          .leftJoin(agent, and(eq(agent.id, mapping.agent_id), AgentQueries.isUsableIn(space.id, found.organizationId)))
          .where(and(eq(mapping.install_id, found.id), eq(mapping.place, event.place.id)))
          .pipe(Effect.orDie)).at(0)
        const trigger = mapped?.triggers.find((setting) => setting.id === event.trigger)
        if (event.trigger && !trigger)
          return yield* new NotTriggered({
            message: `${event.provider} place ${event.place.id} has no mapping with the trigger ${event.trigger}`,
          })
        const task = yield* taskOf(found.organizationId, event)
        const place = task ?? mapped ?? (yield* defaultSpace(found))
        if (!place)
          return yield* new Unroutable({ message: `Organization ${found.organizationId} has no active space` })
        const routed = { ...(mapped ?? unmapped(found.installedBy, event, task)), ...place }
        return {
          organizationId: found.organizationId,
          spaceId: routed.spaceId,
          ...(routed.agentId && { agentId: routed.agentId }),
          senderUserId: yield* runAs(found.organizationId, routed, event),
          text: trigger?.prompt ?? event.text,
          task,
        } satisfies Route
      }),
    })
  }),
)
