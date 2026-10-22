export * as BrainRegistry from "./brain-registry.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly assign: (placement: {
    readonly organizationId: Auth.OrganizationID
    readonly spaceId: Space.ID
    readonly sessionId: Session.ID
  }) => Effect.Effect<Brain.ID>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service

    return Service.of({
      assign: Effect.fn("BrainRegistry.assign")(function* (placement) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const space = (yield* transaction
              .select({ scope: Database.Schema.space.brain_scope })
              .from(Database.Schema.space)
              .where(eq(Database.Schema.space.id, placement.spaceId))).at(0)
            if (!space) return yield* Effect.die(new Error(`Space ${placement.spaceId} does not exist`))
            if (space.scope === "session") {
              const id = Brain.ofSession(placement.sessionId)
              yield* transaction
                .insert(Database.Schema.brain)
                .values({
                  id,
                  organization_id: placement.organizationId,
                  space_id: placement.spaceId,
                  scope: "session",
                })
                .onConflictDoNothing()
              return id
            }
            yield* transaction
              .insert(Database.Schema.brain)
              .values({
                id: Brain.ID.create(),
                organization_id: placement.organizationId,
                space_id: placement.spaceId,
                scope: "space",
              })
              .onConflictDoNothing({
                target: Database.Schema.brain.space_id,
                where: sql`${Database.Schema.brain.scope} = 'space'`,
              })
            const found = (yield* transaction
              .select({ id: Database.Schema.brain.id })
              .from(Database.Schema.brain)
              .where(
                and(eq(Database.Schema.brain.space_id, placement.spaceId), eq(Database.Schema.brain.scope, "space")),
              )).at(0)
            if (!found) return yield* Effect.die(new Error(`Space ${placement.spaceId} has no space brain`))
            return found.id
          }),
        )
      }),
    })
  }),
)
