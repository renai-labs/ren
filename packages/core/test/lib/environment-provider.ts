export * as TestProvider from "./environment-provider.js"

import { Environment } from "@ren/schema/environment"
import { type Duration, Effect, type Option, Ref, Schema } from "effect"
import { EnvironmentProvider } from "../../src/environment-provider.js"

const Config = Schema.Struct({
  label: Schema.NonEmptyString.annotate({ title: "Label", description: "A name for the test environments." }),
}).annotate({ title: "Test" })

interface Provisioned {
  readonly environmentId: Environment.ID
  readonly image: Option.Option<string>
  readonly hosts: Option.Option<ReadonlyArray<string>>
}

interface Probe {
  readonly provisions: Ref.Ref<ReadonlyArray<Environment.ID>>
  readonly provisioned: Ref.Ref<ReadonlyArray<Provisioned>>
  readonly keptAlive: Ref.Ref<
    ReadonlyArray<{ readonly environmentId: Environment.ID; readonly duration: Duration.Duration }>
  >
  readonly builds: Ref.Ref<ReadonlyArray<string>>
  readonly buildFails: Ref.Ref<boolean>
  readonly destroyed: Ref.Ref<ReadonlyArray<Environment.ID>>
  readonly gone: Ref.Ref<ReadonlySet<Environment.ID>>
  readonly failing: Ref.Ref<boolean>
  readonly provider: EnvironmentProvider.Provider
}

export const make = (
  options: {
    readonly id?: string
    readonly egress?: boolean
    readonly canMount?: boolean
    readonly canLimitHosts?: boolean
    readonly builds?: boolean
    readonly base?: string
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
    const provisioned = yield* Ref.make<ReadonlyArray<Provisioned>>([])
    const keptAlive = yield* Ref.make<
      ReadonlyArray<{ readonly environmentId: Environment.ID; readonly duration: Duration.Duration }>
    >([])
    const builds = yield* Ref.make<ReadonlyArray<string>>([])
    const buildFails = yield* Ref.make(false)
    const endpoint =
      options.endpoint ??
      ((environmentId: Environment.ID): Effect.Effect<EnvironmentProvider.Endpoint, EnvironmentProvider.Gone> =>
        Effect.succeed({ url: new URL(`http://${environmentId.toLowerCase()}.test`) }))
    const provider = EnvironmentProvider.make({
      id: EnvironmentProvider.ID.make(options.id ?? "test"),
      title: "Test",
      description: "Environments that live in the test’s memory.",
      egress: options.egress ?? false,
      canMount: options.canMount ?? false,
      canLimitHosts: options.canLimitHosts ?? false,
      config: Config,
      binding: Schema.Struct({ environmentId: Environment.ID }),
      ...(options.builds && {
        build: {
          base: options.base ?? "test-base:1",
          run: (input) =>
            Effect.gen(function* () {
              yield* Ref.update(builds, (all) => [...all, input.tag])
              if (yield* Ref.get(buildFails))
                return yield* new EnvironmentProvider.Failed({ message: "the test build fails" })
              return `test-image:${input.tag}`
            }),
        },
      }),
      provision: (input) =>
        Effect.gen(function* () {
          if (yield* Ref.get(failing))
            return yield* new EnvironmentProvider.Failed({ message: "the test provider fails" })
          yield* Ref.update(provisions, (all) => [...all, input.environmentId])
          yield* Ref.update(provisioned, (all) => [
            ...all,
            { environmentId: input.environmentId, image: input.image, hosts: input.network.hosts },
          ])
          return { environmentId: input.environmentId }
        }),
      keepAlive: (binding, duration) =>
        Ref.update(keptAlive, (all) => [...all, { environmentId: binding.environmentId, duration }]),
      connect: (binding) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(gone)).has(binding.environmentId))
            return yield* new EnvironmentProvider.Gone({ message: `environment ${binding.environmentId} is gone` })
          return yield* endpoint(binding.environmentId)
        }),
      destroy: (binding) => Ref.update(destroyed, (all) => [...all, binding.environmentId]),
    })
    return {
      provisions,
      provisioned,
      keptAlive,
      builds,
      buildFails,
      destroyed,
      gone,
      failing,
      provider,
    } satisfies Probe
  })
