export * as BrainProvider from "./brain-provider.js"

import { Context, Effect, Layer, Option } from "effect"
import { MachineProvider } from "./machine-provider.js"

// oxlint-disable-next-line ren/no-comments -- The deployment's brain provider, in a list so that a Ren with brains in cells has none.
export class Registry extends Context.Service<Registry, MachineProvider.Registry>()(
  "@ren/core/BrainProvider/Registry",
) {}

export const layer = <E = never, R = never>(providers: ReadonlyArray<Effect.Effect<MachineProvider.Provider, E, R>>) =>
  Layer.effect(Registry, MachineProvider.registry(providers))

// oxlint-disable-next-line ren/no-comments -- The deployment's provider for new brains: its first one. None for a Ren whose brains run in cells.
export const defaultOf = (registry: MachineProvider.Registry) => Option.fromNullishOr(registry.providers.at(0))

export const first = Effect.flatMap(Registry, (registry) =>
  Option.match(defaultOf(registry), {
    onNone: () => Effect.die(new Error("This Ren registers no brain provider")),
    onSome: Effect.succeed,
  }),
)
