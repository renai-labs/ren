export * as TestProvider from "./environment-provider.js"

import { Environment } from "@ren/schema/environment"
import { Effect, type Option, Ref, Schema } from "effect"
import { EnvironmentProvider } from "../../src/environment-provider.js"
import { MachineProvider } from "../../src/machine-provider.js"

const Config = Schema.Struct({
  label: Schema.NonEmptyString.annotate({ title: "Label", description: "A name for the test environments." }),
}).annotate({ title: "Test" })

interface Probe {
  readonly provisions: Ref.Ref<ReadonlyArray<Environment.ID>>
  readonly destroyed: Ref.Ref<ReadonlyArray<Environment.ID>>
  readonly gone: Ref.Ref<ReadonlySet<Environment.ID>>
  readonly proxies: Ref.Ref<ReadonlyArray<Option.Option<MachineProvider.Proxy>>>
  readonly failing: Ref.Ref<boolean>
  readonly provider: MachineProvider.Provider
}

export const make = (
  options: {
    readonly id?: string
    readonly egress?: boolean
    readonly canMount?: boolean
    readonly canColocate?: boolean
    readonly canLimitHosts?: boolean
    readonly build?: (config: typeof Config.Type) => Effect.Effect<string, MachineProvider.Failed>
    readonly endpoint?: (environmentId: Environment.ID) => Effect.Effect<{ readonly url: string }, MachineProvider.Gone>
    readonly creating?: Effect.Effect<void>
  } = {},
) =>
  Effect.gen(function* () {
    const provisions = yield* Ref.make<ReadonlyArray<Environment.ID>>([])
    const destroyed = yield* Ref.make<ReadonlyArray<Environment.ID>>([])
    const gone = yield* Ref.make<ReadonlySet<Environment.ID>>(new Set())
    const failing = yield* Ref.make(false)
    const proxies = yield* Ref.make<ReadonlyArray<Option.Option<MachineProvider.Proxy>>>([])
    const endpoint =
      options.endpoint ??
      ((environmentId: Environment.ID): Effect.Effect<{ readonly url: string }, MachineProvider.Gone> =>
        Effect.succeed({ url: `http://${environmentId.toLowerCase()}.test/` }))
    const build = options.build
    const provider = MachineProvider.make({
      id: EnvironmentProvider.ID.make(options.id ?? "test"),
      title: "Test",
      description: "Environments that live in the test’s memory.",
      canEgress: options.egress ?? false,
      canMount: options.canMount ?? false,
      canSample: false,
      canColocate: options.canColocate ?? false,
      canLimitHosts: options.canLimitHosts ?? false,
      config: Config,
      binding: Schema.Struct({ environmentId: Environment.ID }),
      create: (input) =>
        Effect.gen(function* () {
          if (options.creating) yield* options.creating
          if (yield* Ref.get(failing)) return yield* new MachineProvider.Failed({ message: "the test provider fails" })
          const environmentId = Environment.ID.make(input.labels.id)
          yield* Ref.update(provisions, (all) => [...all, environmentId])
          yield* Ref.update(proxies, (all) => [...all, input.network.proxy])
          return { binding: { environmentId }, url: `http://${environmentId.toLowerCase()}.test/` }
        }),
      connect: (binding) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(gone)).has(binding.environmentId))
            return yield* new MachineProvider.Gone({ message: `environment ${binding.environmentId} is gone` })
          return yield* endpoint(binding.environmentId)
        }),
      destroy: (binding) => Ref.update(destroyed, (all) => [...all, binding.environmentId]),
      status: (binding) =>
        Effect.map(Ref.get(gone), (all) => (all.has(binding.environmentId) ? ("gone" as const) : ("running" as const))),
      ...(build && { build: (input: { readonly config: typeof Config.Type }) => build(input.config) }),
    })
    return { provisions, destroyed, gone, failing, proxies, provider } satisfies Probe
  })
