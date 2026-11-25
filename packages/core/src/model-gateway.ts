export * as ModelGateway from "./model-gateway.js"

import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Changed, Field, Limit, Listed, Provider, Window } from "@ren/schema/model-gateway"
import type { Models } from "@ren/schema/models"
import type { Provider as ProviderInput } from "@ren/schema/provider"
import type { Space } from "@ren/schema/space"
import { Context, type DateTime, Effect, Layer, Option, type Redacted, Schema } from "effect"

export { Changed, Field, Limit, Listed, Provider, Window }

// oxlint-disable-next-line ren/no-comments -- The vendor refused a key, or the fields are not the provider's: the person can fix it.
export class Rejected extends Schema.TaggedError<Rejected>()("ModelGateway.Rejected", { message: Schema.String }) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("ModelGateway.Unavailable", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

// oxlint-disable-next-line ren/no-comments -- No method: a provider the deployment connects (`operator`).
export interface Settings {
  readonly enabled: boolean
  readonly method?: Models.Method
  readonly off: ReadonlyArray<string>
}

export interface Fields {
  readonly [name: string]: Redacted.Redacted
}

export interface Saved {
  readonly last4: string
  readonly testedAt: DateTime.Utc
}

export interface Key extends Saved {
  readonly savedBy?: typeof Auth.MemberID.Type
}

// oxlint-disable-next-line ren/no-comments -- Providers P29: a provider's settings as the gateway keeps them. Ren core keeps none.
export interface ProviderSettings extends Settings {
  readonly key?: Key
}

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
  // oxlint-disable-next-line ren/no-comments -- Idempotent per brain: the same valid key until it nears expiry, also after Ren core restarts (the contract suite checks it).
  readonly grant: (input: GrantInput) => Effect.Effect<Grant, Unavailable>
  // oxlint-disable-next-line ren/no-comments -- Providers P29: the organization's settings of each provider it added or changed. A provider not in the answer has its defaults: on, its first method, no key, every model on.
  readonly settings: (
    organizationId: Auth.OrganizationID,
  ) => Effect.Effect<Readonly<Record<string, ProviderSettings>>, Unavailable>
  // oxlint-disable-next-line ren/no-comments -- Providers P29: changes only the fields sent, so two changes at once never undo each other; the gateway allows only what is on and connected (§6.4.1).
  readonly update: (
    provider: string,
    organizationId: Auth.OrganizationID,
    change: ProviderInput.UpdateInput,
  ) => Effect.Effect<void, Unavailable>
  readonly switchModels: (
    provider: string,
    organizationId: Auth.OrganizationID,
    models: ProviderInput.ModelListInput["models"],
  ) => Effect.Effect<void, Unavailable>
  // oxlint-disable-next-line ren/no-comments -- A key provider: test the fields without saving; save them after a passing test; remove them. Ren never stores the fields.
  readonly test: (
    provider: string,
    organizationId: Auth.OrganizationID,
    fields: Fields,
  ) => Effect.Effect<{ readonly ok: boolean; readonly message?: string }, Unavailable | Rejected>
  readonly connect: (
    provider: string,
    organizationId: Auth.OrganizationID,
    fields: Fields,
    savedBy: typeof Auth.MemberID.Type,
  ) => Effect.Effect<Saved, Unavailable | Rejected>
  readonly disconnect: (provider: string, organizationId: Auth.OrganizationID) => Effect.Effect<void, Unavailable>
  // oxlint-disable-next-line ren/no-comments -- Providers §9.3: the limits of a model: the free cap of a free model, and the windows of `seat` when it is one of the provider's seats in the organization. Not the credit, which is billing's.
  readonly limits: (
    provider: string,
    organizationId: Auth.OrganizationID,
    query: { readonly model: string; readonly seat?: string },
  ) => Effect.Effect<ReadonlyArray<Limit>, Unavailable>
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
