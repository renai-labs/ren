export * as TestProvider from "./hand-provider.js"

import { Hand } from "@ren/schema/hand"
import { Effect, Option, Ref, Schema } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import { MachineProvider } from "../../src/machine-provider.js"

const Config = Schema.Struct({
  label: Schema.NonEmptyString.annotate({ title: "Label", description: "A name for the test environments." }),
}).annotate({ title: "Test" })

interface Probe {
  readonly provisions: Ref.Ref<ReadonlyArray<Hand.ID>>
  readonly destroyed: Ref.Ref<ReadonlyArray<Hand.ID>>
  readonly gone: Ref.Ref<ReadonlySet<Hand.ID>>
  readonly networks: Ref.Ref<ReadonlyArray<MachineProvider.Network>>
  readonly keptAlive: Ref.Ref<ReadonlyArray<Hand.ID>>
  // oxlint-disable-next-line ren/no-comments -- The image of each machine it made, in order: null for none.
  readonly images: Ref.Ref<ReadonlyArray<string | null>>
  readonly failing: Ref.Ref<boolean>
  readonly provider: MachineProvider.Provider
  readonly executor: HttpClient.HttpClient
}

export const make = (
  options: {
    readonly id?: string
    readonly egress?: boolean
    readonly canMount?: boolean
    readonly canColocate?: boolean
    readonly canLimitHosts?: boolean
    readonly machineHosts?: ReadonlyArray<string>
    readonly systemImage?: string
    readonly build?: {
      readonly start: (config: typeof Config.Type) => Effect.Effect<MachineProvider.BuildState, MachineProvider.Failed>
      readonly status: (id: string) => Effect.Effect<MachineProvider.BuildState, MachineProvider.Failed>
    }
    readonly endpoint?: (environmentId: Hand.ID) => Effect.Effect<{ readonly url: string }, MachineProvider.Gone>
    // oxlint-disable-next-line ren/no-comments -- Where a create puts the machine; the endpoint then reaches it there. The endpoint by default.
    readonly place?: (environmentId: Hand.ID) => Effect.Effect<{ readonly url: string }>
    readonly creating?: Effect.Effect<void>
  } = {},
) =>
  Effect.gen(function* () {
    const provisions = yield* Ref.make<ReadonlyArray<Hand.ID>>([])
    const destroyed = yield* Ref.make<ReadonlyArray<Hand.ID>>([])
    const gone = yield* Ref.make<ReadonlySet<Hand.ID>>(new Set())
    const failing = yield* Ref.make(false)
    const networks = yield* Ref.make<ReadonlyArray<MachineProvider.Network>>([])
    const keptAlive = yield* Ref.make<ReadonlyArray<Hand.ID>>([])
    const images = yield* Ref.make<ReadonlyArray<string | null>>([])
    const made = yield* Ref.make<
      ReadonlyArray<MachineProvider.Lost & { readonly binding: { readonly environmentId: Hand.ID } }>
    >([])
    const endpoint =
      options.endpoint ??
      ((environmentId: Hand.ID): Effect.Effect<{ readonly url: string }, MachineProvider.Gone> =>
        Effect.succeed({ url: `http://${environmentId.toLowerCase()}.test/` }))
    // oxlint-disable-next-line ren/no-comments -- Like E2B: a machine that is gone answers gone to every call, also when the test ended it through its endpoint.
    const isGone = (environmentId: Hand.ID) =>
      Effect.flatMap(Ref.get(gone), (all) =>
        all.has(environmentId)
          ? Effect.succeed(true)
          : endpoint(environmentId).pipe(
              Effect.as(false),
              Effect.catchTag("MachineProvider.Gone", () => Effect.succeed(true)),
            ),
      )
    const build = options.build
    const provider = MachineProvider.make({
      id: MachineProvider.ID.make(options.id ?? "test"),
      title: "Test",
      description: "Environments that live in the test’s memory.",
      canEgress: options.egress ?? false,
      canMount: options.canMount ?? false,
      ...(options.canColocate && { hand: () => ({ url: "http://own.test/", workspace: "/workspace" }) }),
      ...(options.canLimitHosts && { updateNetwork: () => Effect.void }),
      ...(options.machineHosts && { machineHosts: options.machineHosts }),
      ...(options.systemImage && { systemImage: options.systemImage }),
      config: Config,
      binding: Schema.Struct({ environmentId: Hand.ID }),
      create: (input) =>
        Effect.gen(function* () {
          if (options.creating) yield* options.creating
          if (yield* Ref.get(failing)) return yield* new MachineProvider.Failed({ message: "the test provider fails" })
          const environmentId = Hand.ID.make(input.labels.id)
          // oxlint-disable-next-line ren/no-comments -- A new machine for this id is not the one that was gone.
          yield* Ref.update(gone, (all) => new Set([...all].filter((id) => id !== environmentId)))
          yield* Ref.update(provisions, (all) => [...all, environmentId])
          yield* Ref.update(images, (all) => [...all, Option.getOrNull(input.image)])
          yield* Ref.update(made, (all) => [
            ...all,
            {
              kind: "hand" as const,
              id: environmentId,
              generation: input.labels.generation,
              binding: { environmentId },
            },
          ])
          yield* Ref.update(networks, (all) => [...all, input.network])
          const found = yield* (options.place ?? endpoint)(environmentId).pipe(
            Effect.mapError((error) => new MachineProvider.Failed({ message: error.message })),
          )
          return { binding: { environmentId }, url: found.url }
        }),
      connect: (binding) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(gone)).has(binding.environmentId))
            return yield* new MachineProvider.Gone({ message: `environment ${binding.environmentId} is gone` })
          return yield* endpoint(binding.environmentId)
        }),
      destroy: (binding) => Ref.update(destroyed, (all) => [...all, binding.environmentId]),
      // oxlint-disable-next-line ren/no-comments -- Every machine it made and has not destroyed, with its labels.
      list: Effect.gen(function* () {
        const ended = yield* Ref.get(destroyed)
        return (yield* Ref.get(made)).filter((each) => !ended.includes(each.binding.environmentId))
      }),
      keepAlive: (binding) =>
        Effect.flatMap(isGone(binding.environmentId), (isEnded) =>
          isEnded
            ? Effect.fail(new MachineProvider.Gone({ message: `environment ${binding.environmentId} is gone` }))
            : Ref.update(keptAlive, (all) => [...all, binding.environmentId]),
        ),
      status: (binding) =>
        Effect.map(isGone(binding.environmentId), (isEnded) => (isEnded ? ("gone" as const) : ("running" as const))),
      ...(build && {
        build: {
          start: (input: { readonly config: typeof Config.Type }) => build.start(input.config),
          status: build.status,
        },
      }),
    })
    // oxlint-disable-next-line ren/no-comments -- The executor of each machine it made: it answers as Ren's does, 401 to an unsigned call, until the machine is gone.
    const executor = HttpClient.make((request) =>
      Effect.gen(function* () {
        const host = new URL(request.url).hostname
        const machine = (yield* Ref.get(provisions)).find((environmentId) =>
          host.startsWith(environmentId.toLowerCase()),
        )
        if (!machine || (yield* isGone(machine)))
          return yield* new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: "no executor answers" }),
          })
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 401 }))
      }),
    )
    return { provisions, destroyed, gone, failing, networks, keptAlive, images, provider, executor } satisfies Probe
  })

// oxlint-disable-next-line ren/no-comments -- The executors of the machines of several test providers: the first one that knows the machine answers.
export const executors = (probes: ReadonlyArray<Pick<Probe, "executor">>) =>
  HttpClient.make((request) => Effect.firstSuccessOf(probes.map((probe) => probe.executor.execute(request))))
