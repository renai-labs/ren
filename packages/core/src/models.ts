export * as Models from "./models.js"

import type { Auth } from "@ren/schema/auth"
import { Models } from "@ren/schema/models"
import type { Session } from "@ren/schema/session"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

export { Access, Catalog, Endpoint } from "@ren/schema/models"

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
  readonly renewIfDue: (subject: Subject) => Effect.Effect<Option.Option<Models.Access>, Unavailable>
  readonly revoke: (subject: Subject) => Effect.Effect<void, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Models") {}

export const layerConfigured = Layer.effect(
  Service,
  Effect.gen(function* () {
    const endpoints = yield* Config.option(
      Config.schema(
        Schema.RedactedFromValue(Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Models.Endpoint)))),
        "MODEL_ENDPOINTS",
      ),
    )
    const access = Models.Access.make({
      endpoints: Option.match(endpoints, { onNone: () => [], onSome: (value) => Redacted.value(value) }),
    })
    return Service.of({
      catalog: Effect.fn("Models.catalog")(function* () {
        return Models.catalog(access)
      }),
      grant: Effect.fn("Models.grant")(function* () {
        return access
      }),
      renewIfDue: Effect.fn("Models.renewIfDue")(function* () {
        return Option.none()
      }),
      revoke: Effect.fn("Models.revoke")(function* () {}),
    })
  }),
)
