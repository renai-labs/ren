export * as Models from "./models.js"

import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import type { Space } from "@ren/schema/space"
import { Context, Effect, Layer, Schema, Struct } from "effect"
import { ModelLists } from "./model-lists.js"

export {
  Access,
  Catalog,
  CatalogEndpoint,
  Endpoint,
  Info,
  Registration,
  registrations,
  catalog,
  personLabel,
  placeholderKey,
} from "@ren/schema/models"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Models.Unavailable", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly providers: (organizationId: Auth.OrganizationID) => Effect.Effect<Models.Providers, Unavailable>
  readonly catalog: (organizationId: Auth.OrganizationID) => Effect.Effect<Models.Catalog, Unavailable>
  readonly baseUrls: Effect.Effect<ReadonlyArray<string>>
  readonly revision: Effect.Effect<string>
  readonly grant: (
    brainId: Brain.ID,
    organizationId: Auth.OrganizationID,
    spaceId: Space.ID,
  ) => Effect.Effect<Models.Access, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Models") {}

// oxlint-disable-next-line ren/no-comments -- Providers P16: every card's models are called through the one model gateway, at its base URL with the brain's key.
export interface Gateway {
  readonly baseUrl: string
  readonly key: (
    brainId: Brain.ID,
    organizationId: Auth.OrganizationID,
    spaceId: Space.ID,
  ) => Effect.Effect<Models.ApiKey, Unavailable>
}

export const layer = <E, R>(gateway: Effect.Effect<Gateway, E, R>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const found = yield* gateway
      const lists = yield* ModelLists.Service
      const endpoints = (organizationId: Auth.OrganizationID) =>
        Effect.map(lists.list(organizationId), (cards) =>
          cards.map((card): Models.CatalogEndpoint => Struct.assign(card, { baseUrl: found.baseUrl })),
        )
      return Service.of({
        providers: Effect.fn("Models.providers")(function* (organizationId) {
          return Models.registrations({ endpoints: yield* endpoints(organizationId) })
        }),
        catalog: Effect.fn("Models.catalog")(function* (organizationId) {
          return { endpoints: yield* endpoints(organizationId) }
        }),
        baseUrls: Effect.succeed([found.baseUrl]),
        revision: lists.revision,
        grant: Effect.fn("Models.grant")(function* (brainId, organizationId, spaceId) {
          const apiKey = yield* found.key(brainId, organizationId, spaceId)
          const listed = yield* endpoints(organizationId)
          return Models.Access.make({
            endpoints: listed.map((endpoint) => Struct.assign(endpoint, { apiKey })),
          })
        }),
      })
    }),
  )

// oxlint-disable-next-line ren/no-comments -- A Ren without the model gateway has no models.
export const layerNone = Layer.succeed(
  Service,
  Service.of({
    providers: () => Effect.succeed([]),
    catalog: () => Effect.succeed({ endpoints: [] }),
    baseUrls: Effect.succeed([]),
    revision: Effect.succeed("none"),
    grant: () => Effect.succeed(Models.Access.make({ endpoints: [] })),
  }),
)
