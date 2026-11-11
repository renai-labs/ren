export * as E2BSandbox from "./e2b.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { App } from "@ren/schema/app"
import { Auth } from "@ren/schema/auth"
import { Identifier } from "@ren/schema/identifier"
import { Space } from "@ren/schema/space"
import { Workload } from "@ren/schema/workload"
import { Config, DateTime, Duration, Effect, Option, Redacted, Schema } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { EnvironmentProvider } from "../environment-provider.js"
import { MachineProvider } from "../machine-provider.js"

// oxlint-disable-next-line ren/no-comments -- Sandboxes are tagged with the Ren that made them. One E2B team can serve several Rens (developers); each lists, counts and cleans up only its own (E2B_OWNER).
export const defaultOwner = "ren-v2-dev"

const envdPort = 49983

const envFile = "/home/user/.ren/brain.env"

export const caFile = "/home/user/.ren/egress-ca.pem"

// oxlint-disable-next-line ren/no-comments -- E2B sends host names to the proxy only when a domain entry allows the connection; `*` with a deny of all IP ranges sends every connection to the proxy by name (README §11a rows 1 and 2). A host list allows only its hosts, and `*.x.com` also allows `x.com` (networking rule 3). An update replaces the whole config, so each one repeats the proxy. None: E2B's default, any host.
const networkOf = (network: MachineProvider.Network) => {
  if (Option.isNone(network.proxy) && Option.isNone(network.hosts)) return Option.none()
  const allowOut = Option.match(network.hosts, {
    onNone: () => ["*"],
    onSome: (hosts) => [...new Set(hosts.flatMap((host) => (host.startsWith("*.") ? [host, host.slice(2)] : [host])))],
  })
  return Option.some({
    allowOut,
    denyOut: ["0.0.0.0/0"],
    ...Option.match(network.proxy, {
      onNone: () => ({}),
      onSome: (proxy) => ({
        egressProxy: { address: proxy.address, username: proxy.username, password: Redacted.value(proxy.password) },
      }),
    }),
  })
}

const createTimeout = Duration.minutes(10)

// oxlint-disable-next-line ren/no-comments -- EN42: every hand on E2B, co-located or remote, keeps its chats' folders here.
const workspace = "/home/user/workspace"

const Binding = Schema.Struct({
  sandboxId: Schema.NonEmptyString,
  domain: Schema.NonEmptyString,
  port: Schema.Int,
})
type Binding = typeof Binding.Type

const Created = Schema.Struct({
  sandboxID: Schema.String,
  domain: Schema.optional(Schema.NullOr(Schema.String)),
  envdAccessToken: Schema.optional(Schema.NullOr(Schema.String)),
})

const Listed = Schema.Array(
  Schema.Struct({
    sandboxID: Schema.String,
    state: Schema.optional(Schema.String),
    metadata: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
  }),
)

const Detail = Schema.Struct({ state: Schema.optional(Schema.String) })

const Samples = Schema.Array(
  Schema.Struct({
    timestampUnix: Schema.Number,
    memUsed: Schema.Number,
    memTotal: Schema.Number,
    diskUsed: Schema.Number,
    diskTotal: Schema.Number,
  }),
)

const sampleWindow = Duration.minutes(30)

const share = (used: number, total: number) => (total > 0 ? used / total : 0)

const runTypes = ["sandbox.lifecycle.paused", "sandbox.lifecycle.killed"] as const

const Runs = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    type: Schema.Literals(runTypes),
    timestamp: Schema.DateTimeUtcFromString,
    sandboxId: Schema.String,
    eventData: Schema.Unknown,
  }),
)
type Run = (typeof Runs.Type)[number]

const Measured = Schema.Struct({
  sandbox_metadata: Schema.Struct({
    owner: Schema.String,
    brain: Schema.String,
    generation: Schema.NumberFromString,
    kind: Schema.optional(Workload.Kind),
    organization: Auth.OrganizationID,
    space: Space.ID,
  }),
  execution: Schema.Struct({ execution_time: Schema.Int, vcpu_count: Schema.Int, memory_mb: Schema.Int }),
})

const pageSize = 100

// oxlint-disable-next-line ren/no-comments -- A template's config (templates rule 1). E2B fixes CPU and memory when it builds an image, so they are build settings. A brain without a template decodes {} to the defaults.
const TemplateConfig = Schema.Struct({
  cpuCount: Schema.Literals([1, 2, 4, 6, 8])
    .annotate({ title: "CPUs" })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed(2 as const))),
  memoryMiB: Schema.Literals([1024, 2048, 4096, 6144, 8192])
    .annotate({ title: "Memory (MiB)" })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed(2048 as const))),
  ...App.Environment.fields,
}).annotate({ title: "E2B" })

const Tags = Schema.Array(Schema.Struct({ tag: Schema.String }))

const Requested = Schema.Struct({ templateID: Schema.String, buildID: Schema.String })

// oxlint-disable-next-line ren/no-comments -- A build's id for Ren: E2B's ids and the image it makes.
const Started = Schema.Struct({ ...Requested.fields, image: Schema.String })

const BuildStatus = Schema.Struct({
  status: Schema.String,
  reason: Schema.optional(Schema.NullOr(Schema.Struct({ message: Schema.optional(Schema.String) }))),
})

// oxlint-disable-next-line ren/no-comments -- A failed status gives only the first page of the build log; this endpoint gives its last lines, newest first.
const BuildLogs = Schema.Struct({ logs: Schema.Array(Schema.Struct({ message: Schema.String })) })

const logLinesShown = 8

const startCommand = "/opt/ren/start.sh"

const quoteAll = (names: ReadonlyArray<string> | undefined) => (names ?? []).map(quote).join(" ")

// oxlint-disable-next-line ren/no-comments -- Templates rule 4: one RUN per package manager, as root, which installs the manager when the system image lacks it; then one RUN per build command, as the sandbox user.
const stepsOf = (config: Pick<typeof TemplateConfig.Type, "packages" | "buildCommands">) => {
  const root = (command: string): MachineProvider.Step => ({ command, user: "root" })
  const apt = "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y"
  const packages = config.packages
  return [
    ...(packages.apt?.length ? [root(`${apt} ${quoteAll(packages.apt)}`)] : []),
    ...(packages.npm?.length
      ? [root(`(command -v npm || (${apt} nodejs npm)) && npm install -g ${quoteAll(packages.npm)}`)]
      : []),
    ...(packages.pip?.length
      ? [
          root(
            `(command -v pip3 || (${apt} python3-pip)) && pip3 install --break-system-packages ${quoteAll(packages.pip)}`,
          ),
        ]
      : []),
    ...(packages.go?.length
      ? [root(`(command -v go || (${apt} golang-go)) && GOBIN=/usr/local/bin go install ${quoteAll(packages.go)}`)]
      : []),
    ...config.buildCommands.map((command): MachineProvider.Step => ({ command, user: "user" })),
  ]
}

const managers = ["apt", "npm", "pip", "go"] as const

// oxlint-disable-next-line ren/no-comments -- Templates rules 2 and 3: a config that keeps the size, keeps every package and only appends build commands changes a machine in place, with the steps of what it adds.
const stepsBetween = (from: typeof TemplateConfig.Type, to: typeof TemplateConfig.Type) => {
  const added = (manager: (typeof managers)[number]) =>
    (to.packages[manager] ?? []).filter((name) => !(from.packages[manager] ?? []).includes(name))
  const keeps =
    from.cpuCount === to.cpuCount &&
    from.memoryMiB === to.memoryMiB &&
    managers.every((manager) => (from.packages[manager] ?? []).every((name) => to.packages[manager]?.includes(name))) &&
    from.buildCommands.every((command, index) => to.buildCommands[index] === command)
  return keeps
    ? Option.some(
        stepsOf({
          packages: Object.fromEntries(managers.map((manager) => [manager, added(manager)])),
          buildCommands: to.buildCommands.slice(from.buildCommands.length),
        }),
      )
    : Option.none()
}

const failed = (operation: string) => (error: { readonly message: string }) =>
  new MachineProvider.Failed({ message: `E2B ${operation}: ${error.message}` })

const decode =
  <A>(operation: string, schema: Schema.Codec<A, unknown>) =>
  (text: string) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(Effect.mapError(failed(operation)))

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`

export const provider = Effect.gen(function* () {
  const config = yield* Config.all({
    key: Config.Redacted("E2B_API_KEY"),
    template: Config.String("E2B_TEMPLATE").pipe(Config.withDefault("ren-brain-dev")),
    api: Config.String("E2B_API_URL").pipe(Config.withDefault("https://api.e2b.dev")),
    domain: Config.String("E2B_DOMAIN").pipe(Config.withDefault("e2b.app")),
    port: Config.Int("BRAIN_PORT").pipe(Config.withDefault(4800)),
    owner: Config.String("E2B_OWNER").pipe(Config.withDefault(defaultOwner)),
    vcpuSecond: Config.Number("E2B_VCPU_SECOND_MICRO_USD"),
    gibSecond: Config.Number("E2B_GIB_SECOND_MICRO_USD"),
  })
  const owner = config.owner
  const http = yield* HttpClient.HttpClient
  const api = http.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(config.api),
        HttpClientRequest.setHeader("x-api-key", Redacted.value(config.key)),
      ),
    ),
  )
  const urlOf = (binding: Binding) => `https://${binding.port}-${binding.sandboxId}.${binding.domain}`
  const body = Effect.fnUntraced(function* (operation: string, response: HttpClientResponse.HttpClientResponse) {
    const text = yield* response.text.pipe(Effect.mapError(failed(operation)))
    if (response.status >= 200 && response.status < 300) return text
    if (response.status === 429)
      return yield* new MachineProvider.Capacity({
        message: `E2B ${operation} answered 429: ${text.slice(0, 300)}`,
        retryAfter: Duration.seconds(Number(response.headers["retry-after"] ?? "10") || 10),
      })
    return yield* new MachineProvider.Failed({
      message: `E2B ${operation} answered ${response.status}: ${text.slice(0, 300)}`,
    })
  })
  const strict = (operation: string, response: HttpClientResponse.HttpClientResponse) =>
    body(operation, response).pipe(
      Effect.catchTag("MachineProvider.Capacity", (error) => Effect.fail(failed(operation)(error))),
    )
  const send = (operation: string, request: HttpClientRequest.HttpClientRequest) =>
    api.execute(request).pipe(Effect.timeout("60 seconds"), Effect.mapError(failed(operation)))
  const gone = (binding: Binding) =>
    new MachineProvider.Gone({ message: `E2B sandbox ${binding.sandboxId} does not exist` })
  const list = (metadata: Readonly<Record<string, string>>, state: string) =>
    send(
      "list",
      HttpClientRequest.get("/v2/sandboxes").pipe(
        HttpClientRequest.setUrlParams({
          metadata: new URLSearchParams({ owner, ...metadata }).toString(),
          state,
        }),
      ),
    ).pipe(
      Effect.flatMap((response) => strict("list", response)),
      Effect.flatMap((text) =>
        Schema.decodeUnknownEffect(Schema.fromJsonString(Listed))(text).pipe(Effect.mapError(failed("list"))),
      ),
      Effect.map((sandboxes) => sandboxes.filter((sandbox) => sandbox.metadata?.owner === owner)),
    )
  const page = (offset: number) =>
    send(
      "events",
      HttpClientRequest.get("/events/sandboxes").pipe(
        HttpClientRequest.setUrlParams({ types: runTypes, limit: pageSize, offset }),
      ),
    ).pipe(
      Effect.flatMap((response) => strict("events", response)),
      Effect.flatMap((text) =>
        Schema.decodeUnknownEffect(Schema.fromJsonString(Runs))(text).pipe(Effect.mapError(failed("events"))),
      ),
    )
  const upload = Effect.fnUntraced(function* (
    binding: Binding,
    accessToken: Option.Option<string>,
    path: string,
    content: string,
  ) {
    const form = new FormData()
    form.append("file", new Blob([content]), path.slice(path.lastIndexOf("/") + 1))
    const response = yield* http
      .execute(
        HttpClientRequest.post(
          `https://${envdPort}-${binding.sandboxId}.${binding.domain}/files?path=${encodeURIComponent(path)}&username=user`,
        ).pipe(
          HttpClientRequest.setHeaders(
            Option.match(accessToken, { onNone: () => ({}), onSome: (token) => ({ "x-access-token": token }) }),
          ),
          HttpClientRequest.setBody(HttpBody.formData(form)),
        ),
      )
      .pipe(Effect.mapError(failed("configure")))
    yield* strict("configure", response)
  })
  // oxlint-disable-next-line ren/no-comments -- The CA goes before brain.env, because start.sh installs it into the system store once brain.env exists (C44).
  const configure = Effect.fn("E2BSandbox.configure")(function* (
    binding: Binding,
    accessToken: Option.Option<string>,
    env: Readonly<Record<string, string>>,
    proxy: Option.Option<MachineProvider.Proxy>,
  ) {
    const ca = Option.flatMap(proxy, (found) => found.ca)
    if (Option.isSome(ca)) yield* upload(binding, accessToken, caFile, ca.value)
    const content = Object.keys(env)
      .map((name) => `${name}=${quote(env[name] ?? "")}`)
      .join("\n")
    yield* upload(binding, accessToken, envFile, `${content}\n`)
  })
  // oxlint-disable-next-line ren/no-comments -- Networking rule 4: every connect sends the current host list. E2B refuses a network update of a paused sandbox, so it comes after connect.
  const updateNetwork = Effect.fn("E2BSandbox.updateNetwork")(function* (
    binding: Binding,
    network: MachineProvider.Network,
  ) {
    const rules = networkOf(network)
    if (Option.isNone(rules)) return
    const response = yield* send(
      "network",
      HttpClientRequest.put(`/sandboxes/${binding.sandboxId}/network`).pipe(
        HttpClientRequest.bodyJsonUnsafe(rules.value),
      ),
    )
    if (response.status === 404) return yield* gone(binding)
    yield* strict("network", response)
  })

  return MachineProvider.make({
    id: EnvironmentProvider.ID.make("e2b"),
    title: "E2B",
    description: "A sandbox at E2B.",
    canEgress: true,
    canMount: true,
    machineHosts: [`*.${config.domain}`],
    systemImage: config.template,
    workspace,
    config: TemplateConfig,
    binding: Binding,
    stepsBetween,
    updateNetwork,
    create: Effect.fn("E2BSandbox.create")(function* (input) {
      // oxlint-disable-next-line ren/no-comments -- EN34: the kind label keeps hands apart from brains; Ren reaches a brain at its port and a remote hand at its executor's.
      const metadata = { brain: input.labels.id, generation: String(input.labels.generation), kind: input.labels.kind }
      const port = input.labels.kind === "hand" ? EnvironmentApi.port : config.port
      const existing = (yield* list(metadata, "running,paused")).at(0)
      if (existing) {
        const binding = { sandboxId: existing.sandboxID, domain: config.domain, port }
        // oxlint-disable-next-line ren/no-comments -- E2B refuses a network update of a paused sandbox (networking rule 6), so a sandbox that paused after an earlier create resumes first.
        if (existing.state === "paused")
          yield* body(
            "connect",
            yield* send(
              "connect",
              HttpClientRequest.post(`/sandboxes/${binding.sandboxId}/connect`).pipe(
                HttpClientRequest.bodyJsonUnsafe({ timeout: Duration.toSeconds(createTimeout) }),
              ),
            ),
          )
        yield* updateNetwork(binding, input.network).pipe(
          Effect.catchTag("MachineProvider.Gone", (error) => Effect.fail(failed("network")(error))),
        )
        return { binding, url: urlOf(binding) }
      }
      const response = yield* send(
        "create",
        HttpClientRequest.post("/sandboxes").pipe(
          HttpClientRequest.bodyJsonUnsafe({
            templateID: Option.getOrElse(input.image, () => config.template),
            timeout: Duration.toSeconds(createTimeout),
            autoPause: true,
            secure: true,
            metadata: { owner, ...metadata, organization: input.labels.organizationId, space: input.labels.spaceId },
            envVars: input.variables,
            ...Option.match(networkOf(input.network), { onNone: () => ({}), onSome: (network) => ({ network }) }),
          }),
        ),
      )
      const created = yield* body("create", response).pipe(
        Effect.flatMap((text) =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(Created))(text).pipe(Effect.mapError(failed("create"))),
        ),
      )
      const binding = { sandboxId: created.sandboxID, domain: created.domain ?? config.domain, port }
      yield* configure(binding, Option.fromNullishOr(created.envdAccessToken), input.variables, input.network.proxy)
      return { binding, url: urlOf(binding) }
    }),
    connect: Effect.fn("E2BSandbox.connect")(function* (binding, network) {
      const response = yield* send(
        "connect",
        HttpClientRequest.post(`/sandboxes/${binding.sandboxId}/connect`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ timeout: Duration.toSeconds(createTimeout) }),
        ),
      )
      if (response.status === 404) return yield* gone(binding)
      yield* body("connect", response)
      yield* updateNetwork(binding, network)
      return { url: urlOf(binding) }
    }),
    // oxlint-disable-next-line ren/no-comments -- The image is a tag of the template's own E2B template, named by a hash of the system image and the config, so a config built before gives its image at once.
    build: {
      start: Effect.fn("E2BSandbox.build.start")(function* (input) {
        const name = `ren-template-${Identifier.suffix(input.environmentTemplateId).toLowerCase()}`
        const tag = new Bun.CryptoHasher("sha256")
          .update(`${config.template}\0${JSON.stringify(input.config)}`)
          .digest("hex")
          .slice(0, 16)
        const image = `${name}:${tag}`
        const tags = yield* send("tags", HttpClientRequest.get(`/templates/${name}/tags`))
        if (
          tags.status === 200 &&
          (yield* tags.text.pipe(Effect.mapError(failed("tags")), Effect.flatMap(decode("tags", Tags)))).some(
            (existing) => existing.tag === tag,
          )
        )
          return { _tag: "Ready", image } as const
        const requested = yield* send(
          "build",
          HttpClientRequest.post("/v3/templates").pipe(
            HttpClientRequest.bodyJsonUnsafe({
              name,
              tags: [tag],
              cpuCount: input.config.cpuCount,
              memoryMB: input.config.memoryMiB,
            }),
          ),
        ).pipe(
          Effect.flatMap((response) => strict("build", response)),
          Effect.flatMap(decode("build", Requested)),
        )
        yield* send(
          "build",
          HttpClientRequest.post(`/v2/templates/${requested.templateID}/builds/${requested.buildID}`).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              fromTemplate: config.template,
              steps: stepsOf(input.config).map((step) => ({
                type: "RUN",
                args: [step.command, step.user],
                force: false,
              })),
              startCmd: startCommand,
              readyCmd: `pgrep -f ${startCommand}`,
              force: false,
            }),
          ),
        ).pipe(Effect.flatMap((response) => strict("build", response)))
        return { _tag: "Building", id: JSON.stringify({ ...requested, image }) } as const
      }),
      // oxlint-disable-next-line ren/no-comments -- The last lines of the build log say which package or command failed; the admin sees them as the template's build error.
      status: Effect.fn("E2BSandbox.build.status")(function* (id) {
        const build = yield* decode("build", Started)(id)
        const response = yield* send(
          "build status",
          HttpClientRequest.get(`/templates/${build.templateID}/builds/${build.buildID}/status`),
        )
        if (response.status === 404)
          return { _tag: "Failed", reason: "E2B no longer knows this build; save the template again" } as const
        const found = yield* strict("build status", response).pipe(Effect.flatMap(decode("build status", BuildStatus)))
        if (found.status === "ready") return { _tag: "Ready", image: build.image } as const
        if (found.status === "error") {
          const lines = yield* send(
            "build logs",
            HttpClientRequest.get(`/templates/${build.templateID}/builds/${build.buildID}/logs`).pipe(
              HttpClientRequest.setUrlParams({ direction: "backward", limit: logLinesShown }),
            ),
          ).pipe(
            Effect.flatMap((response) => strict("build logs", response)),
            Effect.flatMap(decode("build logs", BuildLogs)),
            Effect.map((found) => found.logs.toReversed().map((entry) => entry.message)),
            Effect.orElseSucceed(() => []),
          )
          return { _tag: "Failed", reason: [found.reason?.message ?? "The build failed", ...lines].join("\n") } as const
        }
        return { _tag: "Building", id } as const
      }),
    },
    keepAlive: Effect.fn("E2BSandbox.keepAlive")(function* (binding, duration) {
      const response = yield* send(
        "timeout",
        HttpClientRequest.post(`/sandboxes/${binding.sandboxId}/timeout`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ timeout: Math.ceil(Duration.toSeconds(duration)) }),
        ),
      )
      if (response.status === 404) return yield* gone(binding)
      yield* strict("timeout", response)
    }),
    destroy: Effect.fn("E2BSandbox.destroy")(function* (binding) {
      const response = yield* send("kill", HttpClientRequest.delete(`/sandboxes/${binding.sandboxId}`))
      if (response.status === 404) return
      yield* strict("kill", response)
    }),
    status: Effect.fn("E2BSandbox.status")(function* (binding) {
      const response = yield* send("info", HttpClientRequest.get(`/sandboxes/${binding.sandboxId}`))
      if (response.status === 404) return "gone" as const
      const text = yield* strict("info", response)
      const detail = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Detail))(text).pipe(
        Effect.mapError(failed("info")),
      )
      return detail.state === "paused" ? ("paused" as const) : ("running" as const)
    }),
    lastSample: Effect.fn("E2BSandbox.lastSample")(function* (binding) {
      const since = DateTime.subtractDuration(yield* DateTime.now, sampleWindow)
      const response = yield* send(
        "metrics",
        HttpClientRequest.get(`/sandboxes/${binding.sandboxId}/metrics`).pipe(
          HttpClientRequest.setUrlParams({ start: String(Math.floor(DateTime.toEpochMillis(since) / 1000)) }),
        ),
      )
      if (response.status === 400 || response.status === 404) return Option.none()
      const text = yield* strict("metrics", response)
      const samples = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Samples))(text).pipe(
        Effect.mapError(failed("metrics")),
      )
      return Option.map(
        Option.fromNullishOr(
          samples.reduce<(typeof samples)[number] | undefined>(
            (newest, each) => (newest && newest.timestampUnix >= each.timestampUnix ? newest : each),
            undefined,
          ),
        ),
        (last): MachineProvider.Sample => ({
          at: DateTime.makeUnsafe(last.timestampUnix * 1000),
          memory: share(last.memUsed, last.memTotal),
          disk: share(last.diskUsed, last.diskTotal),
        }),
      )
    }),
    metered: Effect.fn("E2BSandbox.metered")(function* (since) {
      const older = (run: Run) => Option.exists(since, (time) => DateTime.isLessThan(run.timestamp, time))
      const runsFrom = (offset: number): Effect.Effect<ReadonlyArray<Run>, MachineProvider.Failed> =>
        Effect.flatMap(page(offset), (runs) =>
          runs.length < pageSize || runs.some(older)
            ? Effect.succeed(runs)
            : Effect.map(runsFrom(offset + pageSize), (rest) => [...runs, ...rest]),
        )
      return (yield* runsFrom(0)).flatMap((run) => {
        const measured = Schema.decodeUnknownOption(Measured)(run.eventData)
        if (older(run) || Option.isNone(measured) || measured.value.sandbox_metadata.owner !== owner) return []
        const tags = measured.value.sandbox_metadata
        // oxlint-disable-next-line ren/no-comments -- The `brain` label holds the id of any machine, and `kind` says which (EN34); a sandbox from before `kind` is a brain's.
        const workload = Schema.decodeUnknownOption(Workload.Info)({
          kind: tags.kind ?? "brain",
          id: tags.brain,
          generation: tags.generation,
        })
        if (Option.isNone(workload)) return []
        const execution = measured.value.execution
        const vcpuMs = execution.vcpu_count * execution.execution_time
        const memoryMibMs = execution.memory_mb * execution.execution_time
        return [
          {
            id: run.id,
            sandboxId: run.sandboxId,
            workload: workload.value,
            organizationId: tags.organization,
            spaceId: tags.space,
            endedAt: run.timestamp,
            durationMs: execution.execution_time,
            vcpuMs,
            memoryMibMs,
            costMicroUsd: Math.round(
              (vcpuMs / 1000) * config.vcpuSecond + (memoryMibMs / 1024 / 1000) * config.gibSecond,
            ),
          },
        ]
      })
    }),
    hand: () => ({ url: `http://127.0.0.1:${EnvironmentApi.port}`, workspace }),
    list: list({}, "running,paused").pipe(
      Effect.map((sandboxes) =>
        sandboxes.flatMap((sandbox) => {
          // oxlint-disable-next-line ren/no-comments -- As in metered: a sandbox from before `kind` is a brain's.
          const workload = Schema.decodeUnknownOption(Workload.Info)({
            kind: sandbox.metadata?.kind ?? "brain",
            id: sandbox.metadata?.brain,
            generation: Number(sandbox.metadata?.generation ?? "0"),
          })
          if (Option.isNone(workload)) return []
          const port = workload.value.kind === "hand" ? EnvironmentApi.port : config.port
          return [{ ...workload.value, binding: { sandboxId: sandbox.sandboxID, domain: config.domain, port } }]
        }),
      ),
    ),
  })
})
