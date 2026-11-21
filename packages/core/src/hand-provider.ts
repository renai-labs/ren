export * as HandProvider from "./hand-provider.js"

import { Context, type Effect, Layer } from "effect"
import { MachineProvider } from "./machine-provider.js"

export class Registry extends Context.Service<Registry, MachineProvider.Registry>()(
  "@ren/core/HandProvider/Registry",
) {}

export const layer = <E, R>(providers: ReadonlyArray<Effect.Effect<MachineProvider.Provider, E, R>>) =>
  Layer.effect(Registry, MachineProvider.registry(providers))
