export * as MachineProvider from "./machine-provider.js"

import { HandClient } from "@ren/hand-api/hand-client"
import type { Step as BrainApiStep } from "@ren/host-api/brain-api"
import type { Auth } from "@ren/schema/auth"
import type { Hand } from "@ren/schema/hand"
import { ID, Info, Infos } from "@ren/schema/machine-provider"
import type { MachineTemplate } from "@ren/schema/machine-template"
import type { Space } from "@ren/schema/space"
import type { Workload } from "@ren/schema/workload"
import { type DateTime, Duration, Effect, Option, Redacted, Schedule, Schema, Stream } from "effect"
import { type HttpClient, HttpClientRequest } from "effect/http"

export { ID, Info, Infos }

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

// oxlint-disable-next-line ren/no-comments -- The labels every machine carries. A provider finds the machine an earlier create made by its id and generation, so two creates make one machine.
export interface Labels {
  readonly kind: "brain" | "hand"
  readonly id: string
  readonly generation: number
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
}

// oxlint-disable-next-line ren/no-comments -- Where a machine's traffic may go: through the egress with a proxy login, or only its credential requests to the egress's identity entry (egress-split.md); and to these hosts only (none: to any host). A provider without updateNetwork gets no hosts.
export interface Network {
  readonly proxy: Option.Option<Proxy>
  readonly identity: Option.Option<Identity>
  readonly hosts: Option.Option<ReadonlyArray<string>>
}

export const unrestricted: Network = { proxy: Option.none(), identity: Option.none(), hosts: Option.none() }

// oxlint-disable-next-line ren/no-comments -- The egress's identity entry. The provider names the machine to it with a token it signs outside the machine, for this URL as the audience.
export interface Identity {
  readonly url: string
}

interface CreateInput<Config> {
  readonly labels: Labels
  readonly config: Config
  // oxlint-disable-next-line ren/no-comments -- A template's image; none for the provider's own image.
  readonly image: Option.Option<string>
  readonly variables: Readonly<Record<string, string>>
  readonly network: Network
  // oxlint-disable-next-line ren/no-comments -- Called with the machine's address once the provider knows it and before the machine starts, so its first request to the identity entry finds its workload.
  readonly onAddress?: (address: string) => Effect.Effect<void>
}

export type Step = BrainApiStep

interface BuildInput<Config> {
  readonly environmentTemplateId: MachineTemplate.ID
  readonly config: Config
}

// oxlint-disable-next-line ren/no-comments -- The provider owns each image build. Ren keeps the id of a build in progress and asks for its state; it never waits on one.
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

export interface Created {
  readonly binding: Schema.Json
  readonly url: string
}

export interface Hand {
  readonly url: string
  readonly workspace: Hand.Directory
}

// oxlint-disable-next-line ren/no-comments -- A machine that a provider found gone, named by the labels it was made with.
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
  readonly id: ID
  readonly title: string
  readonly description: string
  // oxlint-disable-next-line ren/no-comments -- Whether this provider can send a machine's traffic through the egress with a proxy login (E2B BYOP, HTTPS_PROXY locally), which replaces ren:<LABEL> placeholders (R19, R57).
  readonly canEgress: boolean
  // oxlint-disable-next-line ren/no-comments -- Whether this provider can name its machines to the egress's identity entry, so only their credential requests go through the egress (egress-split.md).
  readonly canIdentify?: boolean
  readonly canMount: boolean
  // oxlint-disable-next-line ren/no-comments -- The hosts its machines answer on, such as `*.e2b.app`: a brain with a host list reaches its remote hands there.
  readonly machineHosts?: ReadonlyArray<string>
  readonly systemImage?: string
  // oxlint-disable-next-line ren/no-comments -- The folder where a remote hand of this provider keeps one folder per chat.
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
  // oxlint-disable-next-line ren/no-comments -- Sends a running machine its new host list. A provider with it can keep a machine to a list of hosts (a template's `limited` networking).
  readonly updateNetwork?: (binding: Binding, network: Network) => Effect.Effect<void, Gone | Failed>
  readonly build?: Build<Config>
  // oxlint-disable-next-line ren/no-comments -- The steps that bring a machine made from one config to another in place, or none when only a new machine can.
  readonly stepsBetween?: (from: Config, to: Config) => Option.Option<ReadonlyArray<Step>>
  readonly keepAlive?: (binding: Binding, duration: Duration.Duration) => Effect.Effect<void, Gone | Failed>
  readonly status?: (binding: Binding) => Effect.Effect<Status, Failed>
  readonly lastSample?: (binding: Binding) => Effect.Effect<Option.Option<Sample>, Failed>
  // oxlint-disable-next-line ren/no-comments -- The brain's own machine as its tools' hand. A provider with it can run a brain and its tools on one machine.
  readonly hand?: (binding: Binding) => Hand
  readonly list?: Effect.Effect<ReadonlyArray<Lost & { readonly binding: Binding }>, Failed>
  readonly lost?: Stream.Stream<Lost>
  readonly metered?: (since: Option.Option<DateTime.Utc>) => Effect.Effect<ReadonlyArray<Metered>, Failed>
}

export interface Provider {
  readonly info: Info
  readonly canEgress: boolean
  readonly canIdentify: boolean
  readonly canMount: boolean
  readonly machineHosts: ReadonlyArray<string>
  readonly systemImage: string | null
  readonly workspace: Option.Option<string>
  readonly check: (config: unknown) => Effect.Effect<Schema.Json, InvalidConfig>
  readonly create: (input: CreateInput<Schema.Json>) => Effect.Effect<Created, Failed | Capacity>
  readonly connect: (
    binding: Schema.Json,
    network: Network,
  ) => Effect.Effect<{ readonly url: string }, Gone | Failed | Capacity>
  readonly destroy: (binding: Schema.Json) => Effect.Effect<void, Failed>
  readonly updateNetwork: Option.Option<(binding: Schema.Json, network: Network) => Effect.Effect<void, Gone | Failed>>
  readonly build: Option.Option<Build<Schema.Json>>
  readonly stepsBetween: (from: Schema.Json, to: Schema.Json) => Option.Option<ReadonlyArray<Step>>
  readonly keepAlive: (binding: Schema.Json, duration: Duration.Duration) => Effect.Effect<void, Gone | Failed>
  readonly status: (binding: Schema.Json) => Effect.Effect<Status, Failed>
  readonly lastSample: Option.Option<(binding: Schema.Json) => Effect.Effect<Option.Option<Sample>, Failed>>
  readonly hand: Option.Option<(binding: Schema.Json) => Effect.Effect<Hand, Failed>>
  readonly list: Effect.Effect<ReadonlyArray<Listed>, Failed>
  readonly lost: Stream.Stream<Lost>
  readonly metered: (since: Option.Option<DateTime.Utc>) => Effect.Effect<ReadonlyArray<Metered>, Failed>
}

export interface Registry {
  readonly providers: ReadonlyArray<Provider>
  readonly get: (id: string) => Option.Option<Provider>
}

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
  const storedConfig = stored(config, "config")
  const encode = (value: Binding) => Schema.encodeEffect(binding)(value).pipe(Effect.orDie)
  return {
    info: {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      configSchema: Schema.decodeUnknownSync(Schema.Json)(Schema.toJsonSchemaDocument(definition.config)),
      canLimitHosts: Boolean(definition.updateNetwork),
      canColocate: Boolean(definition.hand),
    },
    canEgress: definition.canEgress,
    canIdentify: definition.canIdentify ?? false,
    canMount: definition.canMount,
    machineHosts: definition.machineHosts ?? [],
    systemImage: definition.systemImage ?? null,
    workspace: Option.fromUndefinedOr(definition.workspace),
    check: (value) =>
      Schema.decodeUnknownEffect(config)(value).pipe(
        Effect.flatMap(Schema.encodeEffect(config)),
        Effect.mapError((error) => new InvalidConfig({ message: error.message })),
      ),
    create: (input) =>
      storedConfig(input.config).pipe(
        Effect.flatMap((decoded) => definition.create({ ...input, config: decoded })),
        Effect.flatMap((created) =>
          Effect.map(encode(created.binding), (encoded) => ({ binding: encoded, url: created.url })),
        ),
      ),
    connect: (value, network) =>
      storedBinding(value).pipe(Effect.flatMap((found) => definition.connect(found, network))),
    destroy: (value) => storedBinding(value).pipe(Effect.flatMap(definition.destroy)),
    updateNetwork: Option.map(
      Option.fromUndefinedOr(definition.updateNetwork),
      (updateNetwork) => (value: Schema.Json, network: Network) =>
        storedBinding(value).pipe(Effect.flatMap((found) => updateNetwork(found, network))),
    ),
    stepsBetween: (from, to) => {
      const decode = Schema.decodeUnknownOption(config)
      return Option.flatMap(
        Option.all({ from: decode(from), to: decode(to), steps: Option.fromUndefinedOr(definition.stepsBetween) }),
        (found) => found.steps(found.from, found.to),
      )
    },
    build: Option.map(Option.fromUndefinedOr(definition.build), (build) => ({
      start: (input: BuildInput<Schema.Json>) =>
        storedConfig(input.config).pipe(Effect.flatMap((decoded) => build.start({ ...input, config: decoded }))),
      status: build.status,
    })),
    keepAlive: (value, duration) =>
      Option.match(Option.fromUndefinedOr(definition.keepAlive), {
        onNone: () => Effect.void,
        onSome: (keepAlive) => storedBinding(value).pipe(Effect.flatMap((found) => keepAlive(found, duration))),
      }),
    status: (value) =>
      Option.match(Option.fromUndefinedOr(definition.status), {
        onNone: () => Effect.fail(new Failed({ message: `${definition.id} reports no status` })),
        onSome: (status) => storedBinding(value).pipe(Effect.flatMap(status)),
      }),
    lastSample: Option.map(
      Option.fromUndefinedOr(definition.lastSample),
      (lastSample) => (value: Schema.Json) => storedBinding(value).pipe(Effect.flatMap(lastSample)),
    ),
    hand: Option.map(
      Option.fromUndefinedOr(definition.hand),
      (hand) => (value: Schema.Json) => storedBinding(value).pipe(Effect.map(hand)),
    ),
    list: Option.match(Option.fromUndefinedOr(definition.list), {
      onNone: () => Effect.succeed([]),
      onSome: (list) =>
        Effect.flatMap(list, (listed) =>
          Effect.forEach(listed, (each) =>
            Effect.map(encode(each.binding), (encoded) => ({ ...each, binding: encoded })),
          ),
        ),
    }),
    lost: definition.lost ?? Stream.empty,
    metered: definition.metered ?? (() => Effect.succeed([])),
  }
}

const executorAnswersWithin = Duration.seconds(1)

const executorAskedEvery = Duration.millis(200)

// oxlint-disable-next-line ren/no-comments -- The executor answers an unsigned call itself, with 401. A 5xx comes from in front of it: E2B's edge answers 502 for a sandbox or a port that is not there.
export const executorAnswers = (http: HttpClient.HttpClient, url: URL) =>
  http
    .execute(HttpClientRequest.post(HandClient.rpcUrl(url)))
    .pipe(
      Effect.flatMap((response) =>
        response.status < 500 ? Effect.void : Effect.fail(new Error(`${url} answered ${response.status}`)),
      ),
    )

export const waitForExecutor = (http: HttpClient.HttpClient, url: URL, within: Duration.Duration) =>
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

// oxlint-disable-next-line ren/no-comments -- Daily: destroys each machine of this kind that no row knows at its generation: a row that is gone or replaced, or a create that half worked. A provider that cannot list is skipped and logged.
export const destroyStray = Effect.fnUntraced(function* (
  providers: ReadonlyArray<Provider>,
  kind: Labels["kind"],
  knownGenerations: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, number>>,
) {
  const listed = (yield* Effect.forEach(providers, (provider) =>
    provider.list.pipe(
      Effect.map((all) => all.flatMap((each) => (each.kind === kind ? [{ ...each, provider }] : []))),
      Effect.catch((error) =>
        Effect.logWarning(`Cleanup could not list the machines of ${provider.info.id}`, error).pipe(Effect.as([])),
      ),
    ),
  )).flat()
  const known = yield* knownGenerations(listed.map((each) => each.id))
  yield* Effect.forEach(
    listed.filter((each) => known.get(each.id) !== each.generation),
    (each) =>
      each.provider
        .destroy(each.binding)
        .pipe(Effect.catch((error) => Effect.logWarning(`Cleanup of a sandbox of ${each.id} failed`, error))),
    { discard: true },
  )
})
