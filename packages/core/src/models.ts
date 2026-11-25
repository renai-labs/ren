export * as Models from "./models.js"

import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import { Space } from "@ren/schema/space"
import { Cache, Context, DateTime, Duration, Effect, Exit, Layer, Option, Schema, Struct } from "effect"
import { ModelLists } from "./model-lists.js"
import { ModelGateway } from "./model-gateway.js"

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
  readonly grant: (
    brainId: Brain.ID,
    organizationId: Auth.OrganizationID,
    spaceId: Space.ID,
  ) => Effect.Effect<Models.Access, Unavailable>
  // oxlint-disable-next-line ren/no-comments -- After a call with a provider's key answers 401, the next grant asks the provider's gateway for a key again.
  readonly forget: (
    brainId: Brain.ID,
    organizationId: Auth.OrganizationID,
    spaceId: Space.ID,
    provider: string,
  ) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Models") {}

// oxlint-disable-next-line ren/no-comments -- Longer than the 15 minutes the egress uses its last answer while Ren is down, so a value it keeps has not expired (C37; ren-v1 INV-24). Minted model keys and the credential source's tokens renew this long before they expire.
export const renewBefore = Duration.minutes(20)

const KeyOf = Schema.fromJsonString(
  Schema.Struct({ brainId: Brain.ID, organizationId: Auth.OrganizationID, spaceId: Space.ID, gateway: Schema.String }),
)
const encodeKeyOf = Schema.encodeSync(KeyOf)
const decodeKeyOf = Schema.decodeSync(KeyOf)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* ModelGateway.Registry
    const lists = yield* ModelLists.Service

    // oxlint-disable-next-line ren/no-comments -- Providers §7.1: a brain's key is kept per brain and gateway, apart from the lists, so a change in models mints no key.
    const keys = yield* Cache.makeWith(
      (key: string) =>
        Effect.gen(function* () {
          const found = decodeKeyOf(key)
          const gateway = registry.gateway(found.gateway)
          if (Option.isNone(gateway)) return yield* Effect.die(new Error(`No model gateway ${found.gateway}`))
          return {
            grant: yield* gateway.value.grant(Struct.omit(found, ["gateway"])),
            grantedAt: yield* DateTime.now,
          }
        }),
      {
        capacity: 10_000,
        timeToLive: (exit) => {
          if (Exit.isFailure(exit)) return Duration.zero
          const found = exit.value
          if (found.grant._tag === "Fixed") return Duration.infinity
          const left = DateTime.distance(found.grantedAt, found.grant.expiresAt)
          return Duration.max(Duration.zero, Duration.subtract(left, renewBefore))
        },
      },
    )

    const endpoints = Effect.fn("Models.endpoints")(function* (organizationId: Auth.OrganizationID) {
      const entries = yield* lists.list(organizationId).pipe(Effect.mapError((cause) => new Unavailable({ cause })))
      return entries.flatMap((entry) =>
        Option.match(registry.gateway(entry.gateway), {
          onNone: (): ReadonlyArray<Models.CatalogEndpoint & { readonly gateway: string }> => [],
          onSome: (gateway) => [
            {
              gateway: gateway.id,
              id: entry.id,
              name: entry.name,
              protocol: entry.protocol,
              ...(entry.method && { method: entry.method }),
              baseUrl: gateway.baseUrl,
              ...(Object.keys(gateway.headers).length > 0 && { headers: gateway.headers }),
              models: entry.models,
            },
          ],
        }),
      )
    })

    const catalogOf = (
      found: ReadonlyArray<Models.CatalogEndpoint & { readonly gateway: string }>,
    ): Models.Catalog => ({
      endpoints: found.map((endpoint) => Struct.omit(endpoint, ["gateway"])),
    })

    return Service.of({
      providers: Effect.fn("Models.providers")(function* (organizationId) {
        return Models.registrations(catalogOf(yield* endpoints(organizationId)))
      }),
      catalog: Effect.fn("Models.catalog")(function* (organizationId) {
        return catalogOf(yield* endpoints(organizationId))
      }),
      baseUrls: Effect.succeed([...new Set(registry.gateways.map((gateway) => gateway.baseUrl))]),
      grant: Effect.fn("Models.grant")(function* (brainId, organizationId, spaceId) {
        const found = yield* endpoints(organizationId)
        const granted = yield* Effect.forEach(
          found,
          (endpoint) =>
            Cache.get(keys, encodeKeyOf({ brainId, organizationId, spaceId, gateway: endpoint.gateway })).pipe(
              Effect.map((key): Models.Endpoint => ({
                ...Struct.omit(endpoint, ["gateway"]),
                apiKey: {
                  key: key.grant.key,
                  ...(key.grant._tag === "Minted" && { expiresAt: key.grant.expiresAt }),
                },
              })),
            ),
          { concurrency: "unbounded" },
        ).pipe(Effect.mapError((cause) => new Unavailable({ cause })))
        return Models.Access.make({ endpoints: granted })
      }),
      forget: Effect.fn("Models.forget")(function* (brainId, organizationId, spaceId, provider) {
        const entries = yield* lists.list(organizationId).pipe(Effect.orElseSucceed(() => []))
        const entry = entries.find((each) => each.id === provider)
        if (entry)
          yield* Cache.invalidate(keys, encodeKeyOf({ brainId, organizationId, spaceId, gateway: entry.gateway }))
      }),
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- A Ren without model gateways has no models.
export const layerNone = Layer.succeed(
  Service,
  Service.of({
    providers: () => Effect.succeed([]),
    catalog: () => Effect.succeed({ endpoints: [] }),
    baseUrls: Effect.succeed([]),
    grant: () => Effect.succeed(Models.Access.make({ endpoints: [] })),
    forget: () => Effect.void,
  }),
)
