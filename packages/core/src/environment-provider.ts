export * as EnvironmentProvider from "./environment-provider.js"

import { EnvironmentClient } from "@ren/environment-api/environment-client"
import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Environment } from "@ren/schema/environment"
import type { EnvironmentProvider } from "@ren/schema/environment-provider"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { type HttpClient, HttpClientRequest } from "effect/http"

export { ID, Info, Infos } from "@ren/schema/environment-provider"

class InvalidConfig extends Schema.TaggedError<InvalidConfig>()("EnvironmentProvider.InvalidConfig", {
  message: Schema.String,
}) {}

export class Gone extends Schema.TaggedError<Gone>()("EnvironmentProvider.Gone", { message: Schema.String }) {}

export class Failed extends Schema.TaggedError<Failed>()("EnvironmentProvider.Failed", { message: Schema.String }) {}

interface ProvisionInput<Config> {
  readonly environmentId: Environment.ID
  readonly environmentTemplateId: EnvironmentTemplate.ID
  readonly config: Config
  readonly variables: Readonly<Record<string, string>>
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
  readonly config: Schema.Codec<Config, unknown>
  readonly binding: Schema.Codec<Binding, unknown>
  readonly provision: (input: ProvisionInput<Config>) => Effect.Effect<Binding, Failed>
  readonly connect: (binding: Binding) => Effect.Effect<Endpoint, Gone | Failed>
  readonly destroy: (binding: Binding) => Effect.Effect<void, Failed>
}

export interface Provider {
  readonly info: EnvironmentProvider.Info
  readonly egress: boolean
  readonly canMount: boolean
  readonly check: (config: unknown) => Effect.Effect<Schema.Json, InvalidConfig>
  readonly provision: (input: ProvisionInput<Schema.Json>) => Effect.Effect<Schema.Json, Failed>
  readonly connect: (binding: Schema.Json) => Effect.Effect<Endpoint, Gone | Failed>
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
      configSchema: Schema.decodeUnknownSync(Schema.Json)(Schema.toJsonSchemaDocument(definition.config)),
    },
    egress: definition.egress,
    canMount: definition.canMount,
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
    connect: (value) => stored(binding)(value).pipe(Effect.flatMap(definition.connect)),
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
