export * as TestProvider from "./environment-provider.js"

import { Environment } from "@ren/schema/environment"
import { Effect, Ref, Schema } from "effect"
import { EnvironmentProvider } from "../../src/environment-provider.js"

const Config = Schema.Struct({
  label: Schema.NonEmptyString.annotate({ title: "Label", description: "A name for the test environments." }),
}).annotate({ title: "Test" })

interface Probe {
  readonly provisions: Ref.Ref<ReadonlyArray<Environment.ID>>
  readonly destroyed: Ref.Ref<ReadonlyArray<Environment.ID>>
  readonly gone: Ref.Ref<ReadonlySet<Environment.ID>>
  readonly failing: Ref.Ref<boolean>
  readonly provider: EnvironmentProvider.Provider
}

export const make = (
  options: {
    readonly id?: string
    readonly egress?: boolean
    readonly endpoint?: (
      environmentId: Environment.ID,
    ) => Effect.Effect<EnvironmentProvider.Endpoint, EnvironmentProvider.Gone>
  } = {},
) =>
  Effect.gen(function* () {
    const provisions = yield* Ref.make<ReadonlyArray<Environment.ID>>([])
    const destroyed = yield* Ref.make<ReadonlyArray<Environment.ID>>([])
    const gone = yield* Ref.make<ReadonlySet<Environment.ID>>(new Set())
    const failing = yield* Ref.make(false)
    const endpoint =
      options.endpoint ??
      ((environmentId: Environment.ID): Effect.Effect<EnvironmentProvider.Endpoint, EnvironmentProvider.Gone> =>
        Effect.succeed({ url: new URL(`http://${environmentId.toLowerCase()}.test`) }))
    const provider = EnvironmentProvider.make({
      id: EnvironmentProvider.ID.make(options.id ?? "test"),
      title: "Test",
      description: "Environments that live in the test’s memory.",
      egress: options.egress ?? false,
      config: Config,
      binding: Schema.Struct({ environmentId: Environment.ID }),
      provision: (input) =>
        Effect.gen(function* () {
          if (yield* Ref.get(failing))
            return yield* new EnvironmentProvider.Failed({ message: "the test provider fails" })
          yield* Ref.update(provisions, (all) => [...all, input.environmentId])
          return { environmentId: input.environmentId }
        }),
      connect: (binding) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(gone)).has(binding.environmentId))
            return yield* new EnvironmentProvider.Gone({ message: `environment ${binding.environmentId} is gone` })
          return yield* endpoint(binding.environmentId)
        }),
      destroy: (binding) => Ref.update(destroyed, (all) => [...all, binding.environmentId]),
    })
    return { provisions, destroyed, gone, failing, provider } satisfies Probe
  })
