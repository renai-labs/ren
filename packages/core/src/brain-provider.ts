export * as BrainProvider from "./brain-provider.js"

import { Context, Effect, Layer } from "effect"
import { MachineProvider } from "./machine-provider.js"

// oxlint-disable-next-line ren/no-comments -- The deployment's brain provider (EN2), in a list so that a Ren with brains in cells has none.
export class Registry extends Context.Service<Registry, MachineProvider.Registry>()(
  "@ren/core/BrainProvider/Registry",
) {}

// oxlint-disable-next-line ren/no-comments -- A Ren whose brains run in cells registers none.
export const layer = <E = never, R = never>(providers: ReadonlyArray<Effect.Effect<MachineProvider.Provider, E, R>>) =>
  Layer.effect(Registry, MachineProvider.registry(providers))

// oxlint-disable-next-line ren/no-comments -- The provider that makes every new brain.
export const first = Effect.gen(function* () {
  const registry = yield* Registry
  const found = registry.providers.at(0)
  if (!found) return yield* Effect.die(new Error("This Ren registers no brain provider"))
  return found
})
