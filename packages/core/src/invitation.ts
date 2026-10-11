export * as Invitation from "./invitation.js"

import { AuthDatabase } from "@ren/db/auth-database"
import { Invitation } from "@ren/schema/invitation"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"

export interface Interface {
  readonly preview: (id: string) => Effect.Effect<Invitation.Preview>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Invitation") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* AuthDatabase.Service
    const schema = AuthDatabase.Schema
    return Service.of({
      preview: Effect.fn("Invitation.preview")(function* (id: string) {
        const rows = yield* Effect.promise(() =>
          database.db
            .select({
              status: schema.invitation.status,
              expiresAt: schema.invitation.expiresAt,
              organizationId: schema.organization.id,
              organizationName: schema.organization.name,
              organizationLogo: schema.organization.logo,
              inviterName: schema.user.name,
              inviterEmail: schema.user.email,
            })
            .from(schema.invitation)
            .leftJoin(schema.organization, eq(schema.invitation.organizationId, schema.organization.id))
            .leftJoin(schema.user, eq(schema.invitation.inviterId, schema.user.id))
            .where(eq(schema.invitation.id, id))
            .limit(1),
        )
        const row = rows[0]
        if (!row?.organizationId || !row.organizationName || !row.inviterEmail) {
          return { state: "invalid", organization: null, inviter: null } satisfies Invitation.Preview
        }
        const state =
          row.status === "accepted"
            ? "accepted"
            : row.status !== "pending"
              ? "unavailable"
              : row.expiresAt <= new Date()
                ? "expired"
                : "pending"
        const preview: typeof Invitation.Preview.Encoded = {
          state,
          organization: { id: row.organizationId, name: row.organizationName, logo: row.organizationLogo },
          inviter: { name: row.inviterName?.trim() || null, email: row.inviterEmail },
        }
        return yield* Schema.decodeEffect(Invitation.Preview)(preview).pipe(Effect.orDie)
      }),
    })
  }),
)
