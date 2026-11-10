export * as Models from "./models.js"

import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import type { Space } from "@ren/schema/space"
import { Context, Effect, Layer, Ref, Schema, Struct } from "effect"

export {
  Access,
  Catalog,
  CatalogEndpoint,
  Endpoint,
  Info,
  InferenceCatalog,
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
  readonly providers: Effect.Effect<Models.Providers, Unavailable>
  readonly catalog: (organizationId: Auth.OrganizationID) => Effect.Effect<Models.Catalog, Unavailable>
  readonly revision: Effect.Effect<string>
  readonly grant: (
    brainId: Brain.ID,
    organizationId: Auth.OrganizationID,
    spaceId: Space.ID,
  ) => Effect.Effect<Models.Access, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Models") {}

export interface Provider {
  readonly id: string
  readonly registration: Models.Registration
  readonly endpoint: Effect.Effect<Models.CatalogEndpoint, Unavailable>
  readonly key: (
    brainId: Brain.ID,
    organizationId: Auth.OrganizationID,
    spaceId: Space.ID,
  ) => Effect.Effect<Models.ApiKey, Unavailable>
}

const encodeCatalog = Schema.encodeSync(Models.Catalog)

export const layer = <E, R>(providers: ReadonlyArray<Effect.Effect<Provider, E, R>>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const all = yield* Effect.all(providers)
      const ids = all.map((provider) => provider.id)
      if (new Set(ids).size !== ids.length)
        return yield* Effect.die(new Error(`Two model providers share an id: ${ids.join(", ")}`))
      const revision = yield* Ref.make("none")
      const catalog = Effect.forEach(
        all,
        (provider) => Effect.map(provider.endpoint, (endpoint) => Struct.assign(endpoint, { id: provider.id })),
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map((endpoints): Models.Catalog => ({ endpoints })),
        Effect.tap((found) => Ref.set(revision, Bun.hash(JSON.stringify(encodeCatalog(found))).toString(16))),
      )
      return Service.of({
        providers: Effect.succeed(all.map((provider) => Struct.assign(provider.registration, { id: provider.id }))),
        catalog: Effect.fn("Models.catalog")(function* () {
          return yield* catalog
        }),
        revision: Ref.get(revision),
        grant: Effect.fn("Models.grant")(function* (brainId, organizationId, spaceId) {
          const endpoints = yield* Effect.forEach(
            all,
            (provider) =>
              Effect.map(provider.key(brainId, organizationId, spaceId), (apiKey): Models.Endpoint => ({
                ...Struct.omit(provider.registration, ["catalog"]),
                id: provider.id,
                ...(provider.registration.catalog === "inference" ? { models: [] } : provider.registration.catalog),
                apiKey,
              })),
            { concurrency: "unbounded" },
          )
          return Models.Access.make({ endpoints })
        }),
      })
    }),
  )

export const layerNone = layer<never, never>([])
