export * as ModelLists from "./model-lists.js"

import { PgClient } from "@effect/sql-pg"
import { Postgres } from "@ren/db/postgres"
import { Auth } from "@ren/schema/auth"
import type { Models } from "@ren/schema/models"
import { Cache, Context, Duration, Effect, Exit, Layer, Stream } from "effect"
import { ModelGateway } from "./model-gateway.js"

// oxlint-disable-next-line ren/no-comments -- One provider of an organization's list: its gateway, how it is called and its models. The gateway's address is added when a brain reads the list.
export interface Entry {
  readonly gateway: string
  readonly id: string
  readonly name: string
  readonly protocol: Models.Protocol
  readonly method?: Models.Method
  readonly models: ReadonlyArray<Models.Info>
}

// oxlint-disable-next-line ren/no-comments -- Providers §6.4.1: until providers have settings, an organization's list holds the providers that need no connection.
const usable = (provider: ModelGateway.Provider) => provider.auth.some((auth) => auth._tag === "operator")

const shared = (provider: ModelGateway.Provider) => provider.models === "shared"

export interface Interface {
  readonly providers: Effect.Effect<ReadonlyArray<ModelGateway.Owned>, ModelGateway.Unavailable>
  // oxlint-disable-next-line ren/no-comments -- Providers §6.4: Ren core stores no list; each pull asks the gateways.
  readonly list: (organizationId: Auth.OrganizationID) => Effect.Effect<ReadonlyArray<Entry>, ModelGateway.Unavailable>
  // oxlint-disable-next-line ren/no-comments -- A gateway says a provider's models changed: the organizations it names pull now.
  readonly changed: (
    change: ModelGateway.Changed,
  ) => Effect.Effect<{ readonly notified: number }, ModelGateway.Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ModelLists") {}

const providersLifetime = Duration.minutes(1)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* ModelGateway.Registry
    const pg = yield* PgClient.PgClient

    // oxlint-disable-next-line ren/no-comments -- The gateways' providers change rarely; a pull does not ask for them each time.
    const providers = yield* Cache.makeWith((_: "providers") => registry.providers, {
      capacity: 1,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? providersLifetime : Duration.zero),
    })

    return Service.of({
      providers: Cache.get(providers, "providers"),
      list: Effect.fn("ModelLists.list")(function* (organizationId) {
        const owned = (yield* Cache.get(providers, "providers")).filter((each) => usable(each.provider))
        return yield* Effect.forEach(
          owned,
          (each) =>
            Effect.map(
              each.gateway.models(each.provider.id, shared(each.provider) ? undefined : organizationId),
              (listed): Entry => ({
                gateway: each.gateway.id,
                id: each.provider.id,
                name: each.provider.name,
                protocol: each.provider.protocol,
                models: listed.models,
              }),
            ),
          { concurrency: "unbounded" },
        )
      }),
      // oxlint-disable-next-line ren/no-comments -- P26: a change for every organization notifies only those that have the provider on, never 'all'.
      changed: Effect.fn("ModelLists.changed")(function* (change) {
        const owned = (yield* Cache.get(providers, "providers")).find((each) => each.provider.id === change.provider)
        if (!owned) return { notified: 0 }
        const organizationIds = change.organizationId
          ? [Auth.OrganizationID.make(change.organizationId)]
          : yield* owned.gateway.organizations(change.provider)
        yield* Effect.forEach(
          organizationIds,
          (organizationId) => pg.notify(Postgres.brainsChannel, `org:${organizationId}`).pipe(Effect.orDie),
          { concurrency: 16, discard: true },
        )
        return { notified: organizationIds.length }
      }),
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- Providers §6.4: each gateway's `changed` pushes to the organizations it names. Ren core never polls a gateway. Each stream subscribes before the layer is built, so no change is lost.
export const layerJob = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ModelGateway.Registry
    const lists = yield* Service
    yield* Effect.forEach(registry.gateways, (gateway) =>
      gateway.changed.pipe(
        Stream.runForEach((change) =>
          lists.changed(change).pipe(
            Effect.tap((pushed) =>
              Effect.logInfo(`Models of ${change.provider} changed: ${pushed.notified} organizations notified`),
            ),
            Effect.catch((error) => Effect.logWarning("A model list change could not be pushed", error)),
          ),
        ),
        Effect.withErrorReporting,
        Effect.forkScoped({ startImmediately: true }),
      ),
    )
  }),
)
