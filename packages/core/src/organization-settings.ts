export * as OrganizationSettings from "./organization-settings.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { OrganizationSettings } from "@ren/schema/organization-settings"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
import { SettingsPolicy } from "./settings/policy.js"
import { SettingsRows } from "./settings/rows.js"

export type Interface = Primitive.Interface<typeof OrganizationSettings.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/OrganizationSettings") {}

const notFound = new Primitive.NotFound({ message: "Organization settings not found." })

const actions = {
  get: Primitive.action(OrganizationSettings.definition, "get"),
  update: Primitive.action(OrganizationSettings.definition, "update"),
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const read = Effect.fnUntraced(function* (transaction: Database.Transaction, actor: Actor.Info) {
      const row = (yield* transaction
        .select()
        .from(Database.Schema.settings)
        .where(eq(Database.Schema.settings.owner_id, actor.organizationId))).at(0)
      return {
        id: actor.organizationId,
        ...(yield* SettingsRows.decode(row)),
        canUpdate: access.isAllowed({ actor, action: actions.update, resource: SettingsPolicy.organization }),
      } satisfies OrganizationSettings.Info
    })

    return Service.of({
      get: Effect.fn("OrganizationSettings.get")(function* (actor: Actor.Info, idOrSlug: string) {
        if (
          idOrSlug !== actor.organizationId ||
          !access.isAllowed({ actor, action: actions.get, resource: SettingsPolicy.organization })
        )
          return yield* notFound
        return yield* database.transaction((transaction) => read(transaction, actor))
      }),
      update: Effect.fn("OrganizationSettings.update")(function* (
        actor: Actor.Info,
        id: Auth.OrganizationID,
        input: OrganizationSettings.UpdateInput,
      ) {
        if (id !== actor.organizationId) return yield* notFound
        if (!access.isAllowed({ actor, action: actions.update, resource: SettingsPolicy.organization }))
          return yield* new Primitive.Forbidden({ message: "Only organization admins can edit organization settings." })
        return yield* database.transaction((transaction) =>
          SettingsRows.write(transaction, { organization_id: id }, input.settings).pipe(
            Effect.andThen(read(transaction, actor)),
          ),
        )
      }),
    })
  }),
)
