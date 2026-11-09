export * as MachineProvider from "./machine-provider.js"

import { EnvironmentClient } from "@ren/environment-api/environment-client"
import type { Auth } from "@ren/schema/auth"
import type { Environment } from "@ren/schema/environment"
import type { EnvironmentProvider } from "@ren/schema/environment-provider"
import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Space } from "@ren/schema/space"
import type { Workload } from "@ren/schema/workload"
import { type DateTime, Duration, Effect, Option, Redacted, Schedule, Schema, Stream } from "effect"
import { type HttpClient, HttpClientRequest } from "effect/http"

export class InvalidConfig extends Schema.TaggedError<InvalidConfig>()("MachineProvider.InvalidConfig", {
  message: Schema.String,
}) {}

export class Gone extends Schema.TaggedError<Gone>()("MachineProvider.Gone", { message: Schema.String }) {}

export class Failed extends Schema.TaggedError<Failed>()("MachineProvider.Failed", { message: Schema.String }) {}

export class Capacity extends Schema.TaggedError<Capacity>()("MachineProvider.Capacity", {
  message: Schema.String,
  retryAfter: Schema.Duration,
}) {}

export type Status = "running" | "paused" | "gone"

// oxlint-disable-next-line ren/no-comments -- The labels every machine carries (EN34). A provider finds the machine an earlier create made by its id and generation, so two creates make one machine.
export interface Labels {
  readonly kind: "brain" | "hand"
  readonly id: string
  readonly generation: number
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
}

// oxlint-disable-next-line ren/no-comments -- Where a machine's traffic may go: through the egress with a proxy login, and to these hosts only (none: to any host). A provider without canLimitHosts gets no hosts.
export interface Network {
  readonly proxy: Option.Option<Proxy>
  readonly hosts: Option.Option<ReadonlyArray<string>>
}

export const unrestricted: Network = { proxy: Option.none(), hosts: Option.none() }

interface CreateInput<Config> {
  readonly labels: Labels
  readonly config: Config
  // oxlint-disable-next-line ren/no-comments -- A template's image; none for the provider's own image.
  readonly image: Option.Option<string>
  readonly variables: Readonly<Record<string, string>>
  readonly network: Network
}

// oxlint-disable-next-line ren/no-comments -- A command that changes a running machine in place, as root or as the machine's user.
export interface Step {
  readonly command: string
  readonly user: "root" | "user"
}

interface BuildInput<Config> {
  readonly environmentTemplateId: EnvironmentTemplate.ID
  readonly config: Config
}

// oxlint-disable-next-line ren/no-comments -- EN30: the provider owns each image build. Ren keeps the id of a build in progress and asks for its state; it never waits on one.
export type BuildState =
  | { readonly _tag: "Building"; readonly id: string }
  | { readonly _tag: "Ready"; readonly image: string }
  | { readonly _tag: "Failed"; readonly reason: string }

interface Build<Config> {
  // oxlint-disable-next-line ren/no-comments -- Starts the image of a template's config. A config built before is Ready at once.
  readonly start: (input: BuildInput<Config>) => Effect.Effect<BuildState, Failed>
  // oxlint-disable-next-line ren/no-comments -- The state of a build that start gave. Failed, the error, means the provider did not answer; Ren asks again.
  readonly status: (id: string) => Effect.Effect<BuildState, Failed>
}

// oxlint-disable-next-line ren/no-comments -- A system image's tag can end with the version of Ren's dependencies built into it (`<name>:<system>-<dependencies>`, brain-runtime/e2b/stage.ts). They only save start.sh a download, so a machine on other dependencies keeps its image; the bundles update them in place (EN26).
export const systemOf = (image: string) => image.replace(/(:[^:-]*)-[^:]*$/, "$1")

export interface Created {
  readonly binding: Schema.Json
  readonly url: string
}

export interface Hand {
  readonly url: string
  readonly workspace: Environment.Directory
}

// oxlint-disable-next-line ren/no-comments -- A machine that a provider found gone, named by the labels it was made with (EN34).
export type Lost = Workload.Info

export type Listed = Workload.Info & { readonly binding: Schema.Json }

export interface Metered {
  readonly id: string
  readonly sandboxId: string
  readonly workload: Workload.Info
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly endedAt: DateTime.Utc
  readonly durationMs: number
  readonly vcpuMs: number
  readonly memoryMibMs: number
  readonly costMicroUsd: number
}

export interface Sample {
  readonly at: DateTime.Utc
  readonly memory: number
  readonly disk: number
}

// oxlint-disable-next-line ren/no-comments -- Where the machine's outbound traffic goes, with the proxy login that names its workload, and the egress CA it must trust (README C2, C38, C44). The provider gives the login to its platform; the machine never sees it.
export interface Proxy {
  readonly address: string
  readonly username: string
  readonly password: Redacted.Redacted
  readonly ca: Option.Option<string>
}

interface Definition<Config, Binding> {
  readonly id: EnvironmentProvider.ID
  readonly title: string
  readonly description: string
  // oxlint-disable-next-line ren/no-comments -- Whether this provider can send a machine's traffic through the egress with a proxy login (E2B BYOP, HTTPS_PROXY locally), which replaces ren:<LABEL> placeholders (R19, R57).
  readonly canEgress: boolean
  readonly canMount: boolean
  readonly canSample: boolean
  // oxlint-disable-next-line ren/no-comments -- Whether its machines can run a brain and that brain's tools on one machine (EN3).
  readonly canColocate: boolean
  // oxlint-disable-next-line ren/no-comments -- Whether it can keep a machine to a list of hosts (a template's `limited` networking).
  readonly canLimitHosts: boolean
  readonly systemImage?: string
  // oxlint-disable-next-line ren/no-comments -- The folder where a remote hand of this provider keeps one folder per chat (EN42).
  readonly workspace?: string
  readonly config: Schema.Codec<Config, unknown>
  readonly binding: Schema.Codec<Binding, unknown>
  readonly create: (
    input: CreateInput<Config>,
  ) => Effect.Effect<{ readonly binding: Binding; readonly url: string }, Failed | Capacity>
  readonly connect: (
    binding: Binding,
    network: Network,
  ) => Effect.Effect<{ readonly url: string }, Gone | Failed | Capacity>
  readonly destroy: (binding: Binding) => Effect.Effect<void, Failed>
  // oxlint-disable-next-line ren/no-comments -- Sends a running machine its new host list (networking rule 4).
  readonly updateNetwork?: (binding: Binding, network: Network) => Effect.Effect<void, Gone | Failed>
  readonly build?: Build<Config>
  // oxlint-disable-next-line ren/no-comments -- The steps that bring a machine made from one config to another in place, or none when only a new machine can (EN22).
  readonly stepsBetween?: (from: Config, to: Config) => Option.Option<ReadonlyArray<Step>>
  readonly keepAlive?: (binding: Binding, duration: Duration.Duration) => Effect.Effect<void, Gone | Failed>
  readonly status?: (binding: Binding) => Effect.Effect<Status, Failed>
  readonly lastSample?: (binding: Binding) => Effect.Effect<Option.Option<Sample>, Failed>
  readonly hand?: (binding: Binding) => Hand
  readonly list?: Effect.Effect<ReadonlyArray<Lost & { readonly binding: Binding }>, Failed>
  readonly lost?: Stream.Stream<Lost>
  readonly metered?: (since: Option.Option<DateTime.Utc>) => Effect.Effect<ReadonlyArray<Metered>, Failed>
}

export interface Provider {
  readonly info: EnvironmentProvider.Info
  readonly canEgress: boolean
  readonly canMount: boolean
  readonly canSample: boolean
  readonly canColocate: boolean
  readonly canLimitHosts: boolean
  readonly systemImage: string | null
  readonly workspace: Option.Option<string>
  readonly check: (config: unknown) => Effect.Effect<Schema.Json, InvalidConfig>
  readonly create: (input: CreateInput<Schema.Json>) => Effect.Effect<Created, Failed | Capacity>
  readonly connect: (
    binding: Schema.Json,
    network: Network,
  ) => Effect.Effect<{ readonly url: string }, Gone | Failed | Capacity>
  readonly destroy: (binding: Schema.Json) => Effect.Effect<void, Failed>
  readonly updateNetwork: (binding: Schema.Json, network: Network) => Effect.Effect<void, Gone | Failed>
  readonly build: Option.Option<Build<Schema.Json>>
  readonly stepsBetween: (from: Schema.Json, to: Schema.Json) => Option.Option<ReadonlyArray<Step>>
  readonly keepAlive: (binding: Schema.Json, duration: Duration.Duration) => Effect.Effect<void, Gone | Failed>
  readonly status: (binding: Schema.Json) => Effect.Effect<Status, Failed>
  readonly lastSample: (binding: Schema.Json) => Effect.Effect<Option.Option<Sample>, Failed>
  readonly hand: (binding: Schema.Json) => Effect.Effect<Hand, Failed>
  readonly list: Effect.Effect<ReadonlyArray<Listed>, Failed>
  readonly lost: Stream.Stream<Lost>
  readonly metered: (since: Option.Option<DateTime.Utc>) => Effect.Effect<ReadonlyArray<Metered>, Failed>
}

export interface Registry {
  readonly providers: ReadonlyArray<Provider>
  readonly get: (id: string) => Option.Option<Provider>
}

// oxlint-disable-next-line ren/no-comments -- The providers of one kind that a deployment registers, one per id.
export const registry = <E, R>(providers: ReadonlyArray<Effect.Effect<Provider, E, R>>) =>
  Effect.gen(function* () {
    const all = yield* Effect.all(providers)
    const ids = all.map((provider) => provider.info.id)
    if (new Set(ids).size !== ids.length)
      return yield* Effect.die(new Error(`Two providers share an id: ${ids.join(", ")}`))
    return {
      providers: all,
      get: (id: string) => Option.fromNullishOr(all.find((provider) => provider.info.id === id)),
    } satisfies Registry
  })

export const make = <Config, Binding>(definition: Definition<Config, Binding>): Provider => {
  const config = Schema.toCodecJson(definition.config)
  const binding = Schema.toCodecJson(definition.binding)
  const stored =
    <A>(schema: Schema.Codec<A, Schema.Json>, name: string) =>
    (value: Schema.Json) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError((error) => new Failed({ message: `${definition.id} ${name}: ${error.message}` })),
      )
  const storedBinding = stored(binding, "binding")
  const encode = (value: Binding) => Schema.encodeEffect(binding)(value).pipe(Effect.orDie)
  const keepAlive = definition.keepAlive
  const status = definition.status
  const lastSample = definition.lastSample
  const hand = definition.hand
  const list = definition.list
  const updateNetwork = definition.updateNetwork
  return {
    info: {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      configSchema: Schema.decodeUnknownSync(Schema.Json)(Schema.toJsonSchemaDocument(definition.config)),
      canLimitHosts: definition.canLimitHosts,
      canColocate: definition.canColocate,
    },
    canEgress: definition.canEgress,
    canMount: definition.canMount,
    canSample: definition.canSample,
    canColocate: definition.canColocate,
    canLimitHosts: definition.canLimitHosts,
    systemImage: definition.systemImage ?? null,
    workspace: Option.fromUndefinedOr(definition.workspace),
    check: (value) =>
      Schema.decodeUnknownEffect(config)(value).pipe(
        Effect.flatMap(Schema.encodeEffect(config)),
        Effect.mapError((error) => new InvalidConfig({ message: error.message })),
      ),
    create: (input) =>
      stored(
        config,
        "config",
      )(input.config).pipe(
        Effect.flatMap((decoded) => definition.create({ ...input, config: decoded })),
        Effect.flatMap((created) =>
          Effect.map(encode(created.binding), (encoded) => ({ binding: encoded, url: created.url })),
        ),
      ),
    connect: (value, network) =>
      storedBinding(value).pipe(Effect.flatMap((found) => definition.connect(found, network))),
    destroy: (value) => storedBinding(value).pipe(Effect.flatMap(definition.destroy)),
    updateNetwork: (value, network) =>
      updateNetwork ? storedBinding(value).pipe(Effect.flatMap((found) => updateNetwork(found, network))) : Effect.void,
    stepsBetween: (from, to) => {
      const decode = Schema.decodeUnknownOption(config)
      return Option.flatMap(
        Option.all({ from: decode(from), to: decode(to), steps: Option.fromUndefinedOr(definition.stepsBetween) }),
        (found) => found.steps(found.from, found.to),
      )
    },
    build: Option.map(Option.fromUndefinedOr(definition.build), (build) => ({
      start: (input: BuildInput<Schema.Json>) =>
        stored(
          config,
          "config",
        )(input.config).pipe(Effect.flatMap((decoded) => build.start({ ...input, config: decoded }))),
      status: build.status,
    })),
    keepAlive: (value, duration) =>
      keepAlive ? storedBinding(value).pipe(Effect.flatMap((found) => keepAlive(found, duration))) : Effect.void,
    status: (value) =>
      status
        ? storedBinding(value).pipe(Effect.flatMap(status))
        : Effect.fail(new Failed({ message: `${definition.id} reports no status` })),
    lastSample: (value) => (lastSample ? storedBinding(value).pipe(Effect.flatMap(lastSample)) : Effect.succeedNone),
    hand: (value) =>
      hand
        ? storedBinding(value).pipe(Effect.map(hand))
        : Effect.fail(new Failed({ message: `${definition.id} runs no hand beside a brain` })),
    list: list
      ? Effect.flatMap(list, (listed) =>
          Effect.forEach(listed, (each) =>
            Effect.map(encode(each.binding), (encoded) => ({ ...each, binding: encoded })),
          ),
        )
      : Effect.succeed([]),
    lost: definition.lost ?? Stream.empty,
    metered: definition.metered ?? (() => Effect.succeed([])),
  }
}

const executorAnswersWithin = Duration.seconds(1)

const executorAskedEvery = Duration.millis(200)

const executorReadyWithin = Duration.seconds(30)

// oxlint-disable-next-line ren/no-comments -- The executor answers an unsigned call itself, with 401. A 5xx comes from in front of it: E2B's edge answers 502 for a sandbox or a port that is not there.
export const executorAnswers = (http: HttpClient.HttpClient, url: URL) =>
  http
    .execute(HttpClientRequest.post(EnvironmentClient.rpcUrl(url)))
    .pipe(
      Effect.flatMap((response) =>
        response.status < 500 ? Effect.void : Effect.fail(new Error(`${url} answered ${response.status}`)),
      ),
    )

export const waitForExecutor = (http: HttpClient.HttpClient, url: URL, within = executorReadyWithin) =>
  executorAnswers(http, url).pipe(
    Effect.timeout(executorAnswersWithin),
    Effect.retry({ schedule: Schedule.spaced(executorAskedEvery) }),
    Effect.timeout(within),
    Effect.mapError(
      () => new Failed({ message: `The executor at ${url} did not answer within ${Duration.format(within)}` }),
    ),
  )

const caVariables = [
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "AWS_CA_BUNDLE",
] as const

// oxlint-disable-next-line ren/no-comments -- For a host where the workload itself names the proxy (local development, README §7): every client reads HTTPS_PROXY or HTTP_PROXY; traffic to the brain's own hand and server stays local (README §6.10 rule 4); every CA variable names the egress CA (C44).
export const proxyEnv = (proxy: Proxy, caPath: string): Readonly<Record<string, string>> => {
  const url = `http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(Redacted.value(proxy.password))}@${proxy.address}`
  return {
    HTTPS_PROXY: url,
    HTTP_PROXY: url,
    https_proxy: url,
    http_proxy: url,
    NO_PROXY: "localhost,127.0.0.1,0.0.0.0,::1",
    no_proxy: "localhost,127.0.0.1,0.0.0.0,::1",
    ...(Option.isSome(proxy.ca) ? Object.fromEntries(caVariables.map((name) => [name, caPath])) : {}),
  }
}
