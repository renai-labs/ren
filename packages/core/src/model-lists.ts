export * as ModelLists from "./model-lists.js"

import { PgClient } from "@effect/sql-pg"
import { Postgres } from "@ren/db/postgres"
import { Auth } from "@ren/schema/auth"
import type { Models } from "@ren/schema/models"
import { Cache, Context, Duration, Effect, Exit, Layer } from "effect"
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

const shared = (provider: ModelGateway.Provider) => provider.models === "shared"

export const builtIn = (provider: ModelGateway.Provider) => provider.auth.some((auth) => auth._tag === "operator")

export const methodsOf = (provider: ModelGateway.Provider) =>
  provider.auth.flatMap((auth) => (auth._tag === "operator" ? [] : [auth._tag]))

// oxlint-disable-next-line ren/no-comments -- The name a brain calls a model by: the id of its switch, and what the gateway allows or refuses.
export const switchId = (model: Models.Info) => model.gateway ?? model.id

export interface State extends ModelGateway.Settings {
  readonly usable: boolean
}

// oxlint-disable-next-line ren/no-comments -- Providers §6.4.1: a provider is in an organization's list only while it is on and connected: by the deployment, by a saved key, or by the subscription method. A provider the gateway has no settings for is on, with its first method, and connected only by the deployment.
export const stateOf = (
  provider: ModelGateway.Provider,
  settings: ModelGateway.ProviderSettings | undefined,
): State => {
  const enabled = settings?.enabled ?? true
  const method = settings?.method ?? methodsOf(provider).at(0)
  return {
    enabled,
    ...(method && { method }),
    off: settings?.off ?? [],
    usable: enabled && (builtIn(provider) || Boolean(settings && (method === "subscription" || settings.key))),
  }
}

export interface Interface {
  readonly providers: Effect.Effect<ReadonlyArray<ModelGateway.Owned>, ModelGateway.Unavailable>
  // oxlint-disable-next-line ren/no-comments -- Providers §6.4: Ren core stores no list; each pull asks the gateways for the settings and the models.
  readonly list: (organizationId: Auth.OrganizationID) => Effect.Effect<ReadonlyArray<Entry>, ModelGateway.Unavailable>
  // oxlint-disable-next-line ren/no-comments -- Providers P29: the organization's settings of every provider, from the gateways; Ren core keeps none.
  readonly settings: (
    organizationId: Auth.OrganizationID,
  ) => Effect.Effect<Readonly<Record<string, ModelGateway.ProviderSettings>>, ModelGateway.Unavailable>
  // oxlint-disable-next-line ren/no-comments -- A provider's models for an organization, on or off, whatever its settings.
  readonly models: (
    organizationId: Auth.OrganizationID,
    owned: ModelGateway.Owned,
  ) => Effect.Effect<ReadonlyArray<Models.Info>, ModelGateway.Unavailable>
  // oxlint-disable-next-line ren/no-comments -- After a change of one organization's settings or seats: its brains pull now. A change for every organization reaches brains at their next pull (Providers §6.4).
  readonly refresh: (organizationId: Auth.OrganizationID) => Effect.Effect<void>
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

    const settings = Effect.fn("ModelLists.settings")(function* (organizationId: Auth.OrganizationID) {
      const all = yield* Effect.forEach(registry.gateways, (gateway) => gateway.settings(organizationId), {
        concurrency: "unbounded",
      })
      return Object.fromEntries(all.flatMap((found) => Object.entries(found)))
    })

    const models = (organizationId: Auth.OrganizationID, owned: ModelGateway.Owned) =>
      Effect.map(
        owned.gateway.models(owned.provider.id, shared(owned.provider) ? undefined : organizationId),
        (listed) => listed.models,
      )

    const notify = (organizationId: Auth.OrganizationID) =>
      pg.notify(Postgres.brainsChannel, `org:${organizationId}`).pipe(
        // oxlint-disable-next-line ren/no-comments -- A push that fails only delays brains to their next pull (Providers §6.4); the change itself is saved.
        Effect.catch((error) => Effect.logWarning("Brains were not told of a model change", error)),
      )

    return Service.of({
      providers: Cache.get(providers, "providers"),
      settings,
      models,
      refresh: notify,
      // oxlint-disable-next-line ren/no-comments -- Providers §6.4: each provider that is on and connected, with its method when it has two (P24), minus the models switched off.
      list: Effect.fn("ModelLists.list")(function* (organizationId) {
        const owned = yield* Cache.get(providers, "providers")
        const found = yield* settings(organizationId)
        return (yield* Effect.forEach(
          owned,
          (each) => {
            const state = stateOf(each.provider, found[each.provider.id])
            if (!state.usable) return Effect.succeed([])
            return Effect.map(models(organizationId, each), (listed): ReadonlyArray<Entry> => [
              {
                gateway: each.gateway.id,
                id: each.provider.id,
                name: each.provider.name,
                protocol: each.provider.protocol,
                ...(state.method && methodsOf(each.provider).length > 1 && { method: state.method }),
                models: listed.filter((model) => !state.off.includes(switchId(model))),
              },
            ])
          },
          { concurrency: "unbounded" },
        )).flat()
      }),
    })
  }),
)
