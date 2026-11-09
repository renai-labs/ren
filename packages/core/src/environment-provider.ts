export * as EnvironmentProvider from "./environment-provider.js"

import { Context, type Effect, Layer } from "effect"
import { MachineProvider } from "./machine-provider.js"

export { ID, Info, Infos } from "@ren/schema/environment-provider"

export class Registry extends Context.Service<Registry, MachineProvider.Registry>()(
  "@ren/core/EnvironmentProvider/Registry",
) {}

export const layer = <E, R>(providers: ReadonlyArray<Effect.Effect<MachineProvider.Provider, E, R>>) =>
  Layer.effect(Registry, MachineProvider.registry(providers))
