export * as InferencePlugin from "./inference-plugin.js"

import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Changed, Field, Limit, Listed, Provider, Window } from "@ren/schema/inference-plugin"
import type { Models } from "@ren/schema/models"
import type { Provider as ProviderInput } from "@ren/schema/provider"
import type { Space } from "@ren/schema/space"
import { Context, type DateTime, Effect, Layer, Option, type Redacted, Schema } from "effect"

export { Changed, Field, Limit, Listed, Provider, Window }

// oxlint-disable-next-line ren/no-comments -- The vendor refused a key, or the fields are not the provider's: the person can fix it.
export class Rejected extends Schema.TaggedError<Rejected>()("InferencePlugin.Rejected", { message: Schema.String }) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("InferencePlugin.Unavailable", {
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

// oxlint-disable-next-line ren/no-comments -- Providers P29: a provider's settings as the inference service keeps them. Ren core keeps none.
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

// oxlint-disable-next-line ren/no-comments -- Providers §6.1: an inference plugin: everything Ren core knows about one inference service, such as Ren's or an owner's LiteLLM. Ren core names no inference service and no provider; a deployment passes its plugins to `layer`.
export interface Plugin {
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
  // oxlint-disable-next-line ren/no-comments -- Providers P29: changes only the fields sent, so two changes at once never undo each other; the inference service allows only what is on and connected (§6.4.1).
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
  readonly plugin: Plugin
  readonly provider: Provider
}

export interface Interface {
  readonly plugins: ReadonlyArray<Plugin>
  readonly providers: Effect.Effect<ReadonlyArray<Owned>, Unavailable>
  readonly plugin: (id: string) => Option.Option<Plugin>
}

export class Registry extends Context.Service<Registry, Interface>()("@ren/core/InferencePlugin/Registry") {}

export const registry = <E, R>(plugins: ReadonlyArray<Effect.Effect<Plugin, E, R>>) =>
  Effect.gen(function* () {
    const all = yield* Effect.all(plugins)
    const ids = all.map((plugin) => plugin.id)
    if (new Set(ids).size !== ids.length)
      return yield* Effect.die(new Error(`Two inference plugins share an id: ${ids.join(", ")}`))
    return Registry.of({
      plugins: all,
      providers: Effect.gen(function* () {
        const owned = (yield* Effect.forEach(
          all,
          (plugin) =>
            Effect.map(plugin.providers, (providers) => providers.map((provider): Owned => ({ plugin, provider }))),
          { concurrency: "unbounded" },
        )).flat()
        const providerIds = owned.map((each) => each.provider.id)
        if (new Set(providerIds).size !== providerIds.length)
          return yield* Effect.die(new Error(`Two providers share an id: ${providerIds.join(", ")}`))
        return owned
      }),
      plugin: (id) => Option.fromNullishOr(all.find((plugin) => plugin.id === id)),
    })
  })

export const layer = <E = never, R = never>(plugins: ReadonlyArray<Effect.Effect<Plugin, E, R>>) =>
  Layer.effect(Registry, registry(plugins))
