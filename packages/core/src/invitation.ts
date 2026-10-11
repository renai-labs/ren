export * as Invitation from "./invitation.js"

import { Database } from "@ren/db/database"
import { Invitation } from "@ren/schema/invitation"
import { Context, Effect, Layer, Schema } from "effect"

export interface Interface {
  readonly preview: (id: string) => Effect.Effect<Invitation.Preview>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Invitation") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    return Service.of({
      preview: Effect.fn("Invitation.preview")(function* (id: string) {
        const row = yield* database.db.query.invitation.findFirst({
          columns: { status: true, expiresAt: true },
          where: { id },
          with: {
            organization: { columns: { id: true, name: true, logo: true } },
            user: { columns: { name: true, email: true } },
          },
        })
        if (!row?.organization || !row.user) {
          return { state: "invalid", organization: null, inviter: null } satisfies Invitation.Preview
        }
        let state: Invitation.Preview["state"]
        switch (row.status) {
          case "accepted":
            state = "accepted"
            break
          case "pending":
            state = row.expiresAt <= new Date() ? "expired" : "pending"
            break
          default:
            state = "unavailable"
        }
        const preview: typeof Invitation.Preview.Encoded = {
          state,
          organization: row.organization,
          inviter: { name: row.user.name.trim() || null, email: row.user.email },
        }
        return yield* Schema.decodeEffect(Invitation.Preview)(preview)
      }, Effect.orDie),
    })
  }),
)
