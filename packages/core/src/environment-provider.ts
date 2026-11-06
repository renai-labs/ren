export * as EnvironmentProvider from "./environment-provider.js"

import type { EnvironmentProvider } from "@ren/schema/environment-provider"
import { Context, Effect, Layer, Option } from "effect"
import type { MachineProvider } from "./machine-provider.js"

export { ID, Info, Infos } from "@ren/schema/environment-provider"

export class Registry extends Context.Service<
  Registry,
  {
    readonly providers: ReadonlyArray<MachineProvider.Provider>
    readonly get: (id: EnvironmentProvider.ID) => Option.Option<MachineProvider.Provider>
  }
>()("@ren/core/EnvironmentProvider/Registry") {}

export const layer = <E, R>(providers: ReadonlyArray<Effect.Effect<MachineProvider.Provider, E, R>>) =>
  Layer.effect(
    Registry,
    Effect.gen(function* () {
      const all = yield* Effect.all(providers)
      const ids = all.map((provider) => provider.info.id)
      if (new Set(ids).size !== ids.length)
        return yield* Effect.die(new Error(`Two environment providers share an id: ${ids.join(", ")}`))
      return Registry.of({
        providers: all,
        get: (id) => Option.fromNullishOr(all.find((provider) => provider.info.id === id)),
      })
    }),
  )
