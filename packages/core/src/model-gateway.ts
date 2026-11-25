export * as ModelGateway from "./model-gateway.js"

import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Changed, Field, Listed, Provider } from "@ren/schema/model-gateway"
import type { Space } from "@ren/schema/space"
import { Context, type DateTime, Effect, Layer, Option, type Redacted, Schema, type Stream } from "effect"

export { Changed, Field, Listed, Provider }

export class Unavailable extends Schema.TaggedError<Unavailable>()("ModelGateway.Unavailable", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface GrantInput {
  readonly brainId: Brain.ID
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
}

// oxlint-disable-next-line ren/no-comments -- Providers §6.1: a minted key always has an expiry, so Ren keeps it until then; a fixed key is kept until a call answers 401.
export type Grant =
  | { readonly _tag: "Minted"; readonly key: Redacted.Redacted; readonly expiresAt: DateTime.Utc }
  | { readonly _tag: "Fixed"; readonly key: Redacted.Redacted }

// oxlint-disable-next-line ren/no-comments -- Providers §6.1: everything Ren core knows about a model gateway, such as the Ren gateway or an owner's LiteLLM. Ren core names no gateway and no provider; a deployment passes its gateways to `layer`.
export interface Gateway {
  readonly id: string
  readonly baseUrl: string
  readonly headers: Readonly<Record<string, string>>
  readonly providers: Effect.Effect<ReadonlyArray<Provider>, Unavailable>
  // oxlint-disable-next-line ren/no-comments -- A shared provider's models are asked for without an organization.
  readonly models: (provider: string, organizationId?: Auth.OrganizationID) => Effect.Effect<Listed, Unavailable>
  readonly changed: Stream.Stream<Changed>
  // oxlint-disable-next-line ren/no-comments -- Providers §6.4: the organizations that have a provider on, for a push after a change for every organization.
  readonly organizations: (provider: string) => Effect.Effect<ReadonlyArray<Auth.OrganizationID>, Unavailable>
  // oxlint-disable-next-line ren/no-comments -- Idempotent per brain: the same valid key until it nears expiry, also after Ren core restarts (the contract suite checks it).
  readonly grant: (input: GrantInput) => Effect.Effect<Grant, Unavailable>
}

export interface Owned {
  readonly gateway: Gateway
  readonly provider: Provider
}

export interface Interface {
  readonly gateways: ReadonlyArray<Gateway>
  readonly providers: Effect.Effect<ReadonlyArray<Owned>, Unavailable>
  readonly gateway: (id: string) => Option.Option<Gateway>
}

export class Registry extends Context.Service<Registry, Interface>()("@ren/core/ModelGateway/Registry") {}

export const registry = <E, R>(gateways: ReadonlyArray<Effect.Effect<Gateway, E, R>>) =>
  Effect.gen(function* () {
    const all = yield* Effect.all(gateways)
    const ids = all.map((gateway) => gateway.id)
    if (new Set(ids).size !== ids.length)
      return yield* Effect.die(new Error(`Two model gateways share an id: ${ids.join(", ")}`))
    return Registry.of({
      gateways: all,
      providers: Effect.gen(function* () {
        const owned = (yield* Effect.forEach(
          all,
          (gateway) =>
            Effect.map(gateway.providers, (providers) => providers.map((provider): Owned => ({ gateway, provider }))),
          { concurrency: "unbounded" },
        )).flat()
        const providerIds = owned.map((each) => each.provider.id)
        if (new Set(providerIds).size !== providerIds.length)
          return yield* Effect.die(new Error(`Two providers share an id: ${providerIds.join(", ")}`))
        return owned
      }),
      gateway: (id) => Option.fromNullishOr(all.find((gateway) => gateway.id === id)),
    })
  })

export const layer = <E = never, R = never>(gateways: ReadonlyArray<Effect.Effect<Gateway, E, R>>) =>
  Layer.effect(Registry, registry(gateways))
