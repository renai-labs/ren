export * as SpaceSettings from "./settings.js"

import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { SpaceSettings } from "@ren/schema/space-settings"
import { and, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { SettingsPolicy } from "../settings/policy.js"
import { SettingsRows } from "../settings/rows.js"
import { SpaceQueries } from "./queries.js"

export type Interface = Primitive.Interface<typeof SpaceSettings.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceSettings") {}

const notFound = new Primitive.NotFound({ message: "Space not found." })

const actions = {
  get: Primitive.action(SpaceSettings.definition, "get"),
  update: Primitive.action(SpaceSettings.definition, "update"),
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const find = Effect.fnUntraced(function* (transaction: Database.Transaction, actor: Actor.Info, id: Space.ID) {
      const row = (yield* transaction
        .select({ membershipId: SpaceQueries.membership.id, settings: Database.Schema.settings })
        .from(Database.Schema.space)
        .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
        .leftJoin(Database.Schema.settings, eq(Database.Schema.settings.owner_id, Database.Schema.space.id))
        .where(
          and(
            eq(Database.Schema.space.id, id),
            eq(Database.Schema.space.organization_id, actor.organizationId),
            isNull(Database.Schema.space.archived_at),
          ),
        )).at(0)
      if (!row) return yield* notFound
      const resource = SettingsPolicy.space(Boolean(row.membershipId))
      if (!access.isAllowed({ actor, action: actions.get, resource })) return yield* notFound
      return {
        resource,
        info: {
          id,
          ...(yield* SettingsRows.decode(row.settings)),
          canUpdate: access.isAllowed({ actor, action: actions.update, resource }),
        } satisfies SpaceSettings.Info,
      }
    })

    return Service.of({
      get: Effect.fn("SpaceSettings.get")(function* (actor: Actor.Info, idOrSlug: string) {
        if (!Schema.is(Space.ID)(idOrSlug)) return yield* notFound
        return (yield* database.transaction((transaction) => find(transaction, actor, idOrSlug))).info
      }),
      update: Effect.fn("SpaceSettings.update")(function* (
        actor: Actor.Info,
        id: Space.ID,
        input: SpaceSettings.UpdateInput,
      ) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* find(transaction, actor, id)
            if (!access.isAllowed({ actor, action: actions.update, resource: found.resource }))
              return yield* new Primitive.Forbidden({ message: "You cannot edit the settings of this space." })
            yield* SettingsRows.write(transaction, { space_id: id }, input.settings)
            return (yield* find(transaction, actor, id)).info
          }),
        )
      }),
    })
  }),
)
