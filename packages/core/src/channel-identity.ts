export * as ChannelIdentity from "./channel-identity.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Result } from "effect"
import { ChannelProvider } from "./channel-provider.js"

export interface Interface {
  readonly find: (
    organizationId: Auth.OrganizationID,
    event: Channel.Event,
  ) => Effect.Effect<Option.Option<Auth.UserID>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelIdentity") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const registry = yield* ChannelProvider.Registry
    const account = Database.Schema.account
    const member = Database.Schema.member
    const user = Database.Schema.user

    const firstUser = (rows: ReadonlyArray<{ readonly userId: string }>) =>
      Option.map(Option.fromNullishOr(rows.at(0)?.userId), (id) => Auth.UserID.make(id))

    return Service.of({
      find: Effect.fn("ChannelIdentity.find")(function* (organizationId: Auth.OrganizationID, event: Channel.Event) {
        const linked = firstUser(
          yield* database.db
            .select({ userId: account.userId })
            .from(account)
            .innerJoin(member, and(eq(member.userId, account.userId), eq(member.organizationId, organizationId)))
            .where(and(eq(account.providerId, event.provider), eq(account.accountId, event.sender.accountId)))
            .pipe(Effect.orDie),
        )
        if (Option.isSome(linked)) return linked
        const provider = registry.get(event.provider)
        if (Option.isNone(provider)) return Option.none()
        const email = yield* provider.value.email(event.install, event.sender).pipe(Effect.result)
        if (Result.isFailure(email)) {
          yield* Effect.logWarning(`The ${event.provider} email of a sender could not be read`, email.failure)
          return Option.none()
        }
        if (Option.isNone(email.success)) return Option.none()
        return firstUser(
          yield* database.db
            .select({ userId: user.id })
            .from(user)
            .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, organizationId)))
            .where(eq(sql`lower(${user.email})`, email.success.value.toLowerCase()))
            .pipe(Effect.orDie),
        )
      }),
    })
  }),
)
