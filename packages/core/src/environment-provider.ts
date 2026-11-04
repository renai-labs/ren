export * as EnvironmentProvider from "./environment-provider.js"

import { EnvironmentClient } from "@ren/environment-api/environment-client"
import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Environment } from "@ren/schema/environment"
import type { EnvironmentProvider } from "@ren/schema/environment-provider"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { type HttpClient, HttpClientRequest } from "effect/http"
import type { SandboxProvider } from "./sandbox-provider.js"

export { ID, Info, Infos } from "@ren/schema/environment-provider"

class InvalidConfig extends Schema.TaggedError<InvalidConfig>()("EnvironmentProvider.InvalidConfig", {
  message: Schema.String,
}) {}

export class Gone extends Schema.TaggedError<Gone>()("EnvironmentProvider.Gone", { message: Schema.String }) {}

export class Failed extends Schema.TaggedError<Failed>()("EnvironmentProvider.Failed", { message: Schema.String }) {}

// oxlint-disable-next-line ren/no-comments -- Where an environment's traffic may go: `hosts` is none for unrestricted networking, and `proxy` is the egress login when the provider sends its traffic through the egress.
export interface Network {
  readonly hosts: Option.Option<ReadonlyArray<string>>
  readonly proxy: Option.Option<SandboxProvider.Proxy>
}

interface ProvisionInput<Config> {
  readonly environmentId: Environment.ID
  readonly environmentTemplateId: EnvironmentTemplate.ID
  readonly config: Config
  // oxlint-disable-next-line ren/no-comments -- The template's last ready build; none for a provider that builds no image.
  readonly image: Option.Option<string>
  readonly network: Network
  readonly variables: Readonly<Record<string, string>>
}

interface BuildInput<Config> {
  readonly environmentTemplateId: EnvironmentTemplate.ID
  readonly config: Config
  // oxlint-disable-next-line ren/no-comments -- A hash of the base image and the config: the same tag is the same image.
  readonly tag: string
}

export interface Endpoint {
  readonly url: URL
}

interface Definition<Config, Binding> {
  readonly id: EnvironmentProvider.ID
  readonly title: string
  readonly description: string
  // oxlint-disable-next-line ren/no-comments -- R57: whether the provider routes its machines' traffic through the egress, which replaces ren:<LABEL> placeholders (R19).
  readonly egress: boolean
  readonly canMount: boolean
  readonly canLimitHosts: boolean
  readonly config: Schema.Codec<Config, unknown>
  readonly binding: Schema.Codec<Binding, unknown>
  readonly build?: {
    // oxlint-disable-next-line ren/no-comments -- The image every build starts from. A new base changes every template's tag, so every template builds again (environments §3 Build rule 6).
    readonly base: string
    // oxlint-disable-next-line ren/no-comments -- Gives the image of a tag it built before at once, without building again (EN25).
    readonly run: (input: BuildInput<Config>) => Effect.Effect<string, Failed>
  }
  readonly provision: (input: ProvisionInput<Config>) => Effect.Effect<Binding, Failed>
  readonly connect: (binding: Binding, network: Network) => Effect.Effect<Endpoint, Gone | Failed>
  readonly keepAlive?: (binding: Binding, duration: Duration.Duration) => Effect.Effect<void, Gone | Failed>
  readonly updateNetwork?: (binding: Binding, network: Network) => Effect.Effect<void, Gone | Failed>
  readonly destroy: (binding: Binding) => Effect.Effect<void, Failed>
}

export interface Provider {
  readonly info: EnvironmentProvider.Info
  readonly egress: boolean
  readonly canMount: boolean
  readonly canLimitHosts: boolean
  readonly check: (config: unknown) => Effect.Effect<Schema.Json, InvalidConfig>
  readonly build: Option.Option<{
    readonly base: string
    readonly run: (input: BuildInput<Schema.Json>) => Effect.Effect<string, Failed>
  }>
  readonly provision: (input: ProvisionInput<Schema.Json>) => Effect.Effect<Schema.Json, Failed>
  readonly connect: (binding: Schema.Json, network: Network) => Effect.Effect<Endpoint, Gone | Failed>
  readonly keepAlive: (binding: Schema.Json, duration: Duration.Duration) => Effect.Effect<void, Gone | Failed>
  readonly updateNetwork: (binding: Schema.Json, network: Network) => Effect.Effect<void, Gone | Failed>
  readonly destroy: (binding: Schema.Json) => Effect.Effect<void, Failed>
}

const executorAnswersWithin = Duration.seconds(1)

const executorAskedEvery = Duration.millis(200)

const executorReadyWithin = Duration.seconds(30)

export const waitForExecutor = (http: HttpClient.HttpClient, url: URL) =>
  http.execute(HttpClientRequest.post(EnvironmentClient.rpcUrl(url))).pipe(
    Effect.asVoid,
    Effect.timeout(executorAnswersWithin),
    Effect.retry({ schedule: Schedule.spaced(executorAskedEvery) }),
    Effect.timeout(executorReadyWithin),
    Effect.mapError(
      () =>
        new Failed({ message: `The executor at ${url} did not answer within ${Duration.format(executorReadyWithin)}` }),
    ),
  )

export const make = <Config, Binding>(definition: Definition<Config, Binding>): Provider => {
  const config = Schema.toCodecJson(definition.config)
  const binding = Schema.toCodecJson(definition.binding)
  const stored =
    <A>(codec: Schema.Codec<A, Schema.Json>) =>
    (value: Schema.Json) =>
      Schema.decodeUnknownEffect(codec)(value).pipe(Effect.orDie)
  return {
    info: {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      canLimitHosts: definition.canLimitHosts,
      configSchema: Schema.decodeUnknownSync(Schema.Json)(Schema.toJsonSchemaDocument(definition.config)),
    },
    egress: definition.egress,
    canMount: definition.canMount,
    canLimitHosts: definition.canLimitHosts,
    check: (value) =>
      Schema.decodeUnknownEffect(config)(value).pipe(
        Effect.flatMap(Schema.encodeEffect(config)),
        Effect.mapError((error) => new InvalidConfig({ message: error.message })),
      ),
    provision: (input) =>
      stored(config)(input.config).pipe(
        Effect.flatMap((decoded) => definition.provision({ ...input, config: decoded })),
        Effect.flatMap((made) => Schema.encodeEffect(binding)(made).pipe(Effect.orDie)),
      ),
    build: Option.map(Option.fromNullishOr(definition.build), (build) => ({
      base: build.base,
      run: (input) =>
        stored(config)(input.config).pipe(Effect.flatMap((decoded) => build.run({ ...input, config: decoded }))),
    })),
    connect: (value, network) =>
      stored(binding)(value).pipe(Effect.flatMap((decoded) => definition.connect(decoded, network))),
    // oxlint-disable-next-line ren/no-comments -- A provider without these keeps its machines awake and their network fixed on its own.
    keepAlive: (value, duration) =>
      stored(binding)(value).pipe(
        Effect.flatMap((decoded) => (definition.keepAlive ? definition.keepAlive(decoded, duration) : Effect.void)),
      ),
    updateNetwork: (value, network) =>
      stored(binding)(value).pipe(
        Effect.flatMap((decoded) =>
          definition.updateNetwork ? definition.updateNetwork(decoded, network) : Effect.void,
        ),
      ),
    destroy: (value) => stored(binding)(value).pipe(Effect.flatMap(definition.destroy)),
  }
}

export class Registry extends Context.Service<
  Registry,
  { readonly providers: ReadonlyArray<Provider>; readonly get: (id: EnvironmentProvider.ID) => Option.Option<Provider> }
>()("@ren/core/EnvironmentProvider/Registry") {}

export const layer = <E, R>(providers: ReadonlyArray<Effect.Effect<Provider, E, R>>) =>
  Layer.effect(
    Registry,
    Effect.gen(function* () {
      const all = yield* Effect.all(providers)
      const ids = all.map((provider) => provider.info.id)
      if (new Set(ids).size !== ids.length)
        return yield* Effect.die(new Error(`Two environment providers share an id: ${ids.join(", ")}`))
      return Registry.of({
        providers: all,
        get: (id) => Option.fromNullishOr(all.find((provider) => provider.info.id === id)),
      })
    }),
  )
