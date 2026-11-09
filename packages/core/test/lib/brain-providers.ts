export * as BrainProviders from "./brain-providers.js"

import { Layer } from "effect"
import { BrainProvider } from "../../src/brain-provider.js"
import { MachineProvider } from "../../src/machine-provider.js"

// oxlint-disable-next-line ren/no-comments -- For tests that change spaces but start no brain: a Ren that registers no brain provider, so a space's checks of its provider pass.
export const none = Layer.effect(BrainProvider.Registry, MachineProvider.registry<never, never>([]))
