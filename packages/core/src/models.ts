export * as Models from "./models.js"

import type { Auth } from "@ren/schema/auth"
import { Models } from "@ren/schema/models"
import type { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Option, Schema } from "effect"

export { Access, Catalog, Endpoint, catalog } from "@ren/schema/models"

export interface Subject {
  readonly brainId: Session.ID
  readonly organizationId: Auth.OrganizationID
}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Models.Unavailable", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly catalog: (subject: Subject) => Effect.Effect<Models.Catalog, Unavailable>
  readonly grant: (subject: Subject) => Effect.Effect<Models.Access, Unavailable>
  readonly refreshIfDue: (subject: Subject) => Effect.Effect<Option.Option<Models.Access>, Unavailable>
  readonly revoke: (subject: Subject) => Effect.Effect<void, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Models") {}

export const layerNone = Layer.succeed(
  Service,
  Service.of({
    catalog: Effect.fn("Models.catalog")(function* () {
      return { endpoints: [] }
    }),
    grant: Effect.fn("Models.grant")(function* () {
      return Models.Access.make({ endpoints: [] })
    }),
    refreshIfDue: Effect.fn("Models.refreshIfDue")(function* () {
      return Option.none()
    }),
    revoke: Effect.fn("Models.revoke")(function* () {}),
  }),
)
