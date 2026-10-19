export * as TestProvider from "./hand-provider.js"

import type { Environment } from "@ren/schema/environment"
import { Hand } from "@ren/schema/hand"
import { Effect, Ref, Schema } from "effect"
import { HandProvider } from "../../src/hand-provider.js"

const Config = Schema.Struct({
  label: Schema.NonEmptyString.annotate({ title: "Label", description: "A name for the test hands." }),
}).annotate({ title: "Test" })

interface Probe {
  readonly provisions: Ref.Ref<ReadonlyArray<Hand.ID>>
  readonly destroyed: Ref.Ref<ReadonlyArray<Hand.ID>>
  readonly gone: Ref.Ref<ReadonlySet<Hand.ID>>
  readonly failing: Ref.Ref<boolean>
  readonly provider: HandProvider.Provider
}

export const make = (
  options: {
    readonly id?: string
    readonly capabilities?: ReadonlyArray<Environment.Capability>
    readonly endpoint?: (handId: Hand.ID) => Effect.Effect<HandProvider.Endpoint, HandProvider.Gone>
  } = {},
) =>
  Effect.gen(function* () {
    const provisions = yield* Ref.make<ReadonlyArray<Hand.ID>>([])
    const destroyed = yield* Ref.make<ReadonlyArray<Hand.ID>>([])
    const gone = yield* Ref.make<ReadonlySet<Hand.ID>>(new Set())
    const failing = yield* Ref.make(false)
    const endpoint =
      options.endpoint ??
      ((handId: Hand.ID): Effect.Effect<HandProvider.Endpoint, HandProvider.Gone> =>
        Effect.succeed({ url: `http://${handId.toLowerCase()}.test`, workspace: "/workspace" }))
    const provider = HandProvider.make({
      id: options.id ?? "test",
      title: "Test",
      description: "Hands that live in the test’s memory.",
      capabilities: options.capabilities ?? ["files", "processes"],
      config: Config,
      binding: Schema.Struct({ handId: Hand.ID }),
      provision: (input) =>
        Effect.gen(function* () {
          if (yield* Ref.get(failing)) return yield* new HandProvider.Failed({ message: "the test provider fails" })
          yield* Ref.update(provisions, (all) => [...all, input.handId])
          return { handId: input.handId }
        }),
      connect: (binding) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(gone)).has(binding.handId))
            return yield* new HandProvider.Gone({ message: `hand ${binding.handId} is gone` })
          return yield* endpoint(binding.handId)
        }),
      destroy: (binding) => Ref.update(destroyed, (all) => [...all, binding.handId]),
    })
    return { provisions, destroyed, gone, failing, provider } satisfies Probe
  })
