export * as ChannelRoute from "./channel-route.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { Space } from "@ren/schema/space"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { ChannelIdentity } from "./channel-identity.js"

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
    const space = Database.Schema.space
    const member = Database.Schema.space_member

    const inSpace = (organizationId: Auth.OrganizationID, spaceId: Space.ID, userId: Auth.UserID) =>
      database.db
        .select({ role: Database.Schema.member.role, spaceMember: member.id })
        .from(Database.Schema.member)
        .leftJoin(member, and(eq(member.space_id, spaceId), eq(member.user_id, userId), isNull(member.archived_at)))
        .where(
          and(eq(Database.Schema.member.organizationId, organizationId), eq(Database.Schema.member.userId, userId)),
        )
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.some((row) => Boolean(row.spaceMember) || Auth.isAdministrator(row.role))),
        )

    return Service.of({
      resolve: Effect.fn("ChannelRoute.resolve")(function* (event: Channel.Event) {
        const found = (yield* database.db
          .select({ organizationId: install.organization_id, installedBy: install.installed_by })
          .from(install)
          .where(and(eq(install.provider, event.provider), eq(install.workspace, event.install)))
          .pipe(Effect.orDie)).at(0)
        if (!found)
          return yield* new Unroutable({ message: `No organization installed ${event.provider} ${event.install}` })
        const oldest = (yield* database.db
          .select({ id: space.id })
          .from(space)
          .where(and(eq(space.organization_id, found.organizationId), isNull(space.archived_at)))
          .orderBy(asc(space.created_at), asc(space.id))
          .limit(1)
          .pipe(Effect.orDie)).at(0)
        if (!oldest)
          return yield* new Unroutable({ message: `Organization ${found.organizationId} has no active space` })
        const route = (senderUserId: Auth.UserID): Route => ({
          organizationId: found.organizationId,
          spaceId: oldest.id,
          senderUserId,
        })
        const sender = yield* identity.find(found.organizationId, event)
        if (Option.isSome(sender) && (yield* inSpace(found.organizationId, oldest.id, sender.value)))
          return route(sender.value)
        if (found.installedBy && (yield* inSpace(found.organizationId, oldest.id, found.installedBy)))
          return route(found.installedBy)
        return yield* new Refused({ reason: "fallback_gone" })
      }),
    })
  }),
)
