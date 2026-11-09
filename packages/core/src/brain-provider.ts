export * as BrainProvider from "./brain-provider.js"

import { Context, Effect, Layer } from "effect"
import { MachineProvider } from "./machine-provider.js"

// oxlint-disable-next-line ren/no-comments -- The deployment's brain providers (EN2). The first one is the default of a space that chose none.
export class Registry extends Context.Service<Registry, MachineProvider.Registry>()(
  "@ren/core/BrainProvider/Registry",
) {}

export const layer = <E, R>(
  providers: readonly [
    Effect.Effect<MachineProvider.Provider, E, R>,
    ...ReadonlyArray<Effect.Effect<MachineProvider.Provider, E, R>>,
  ],
) => Layer.effect(Registry, MachineProvider.registry(providers))

// oxlint-disable-next-line ren/no-comments -- The deployment's first brain provider: the one of a space that chose none.
export const first = Effect.gen(function* () {
  const registry = yield* Registry
  const found = registry.providers.at(0)
  if (!found) return yield* Effect.die(new Error("This Ren registers no brain provider"))
  return found
})
