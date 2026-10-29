export * as E2BSandbox from "./e2b.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { Config, DateTime, Duration, Effect, Layer, Option, Redacted, Schema, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { SandboxProvider } from "../sandbox-provider.js"

// oxlint-disable-next-line ren/no-comments -- Sandboxes are tagged with the Ren that made them. One E2B team can serve several Rens (developers); each lists, counts and cleans up only its own (E2B_OWNER).
export const defaultOwner = "ren-v2-dev"

const envdPort = 49983

const envFile = "/home/user/.ren/brain.env"

export const caFile = "/home/user/.ren/egress-ca.pem"

// oxlint-disable-next-line ren/no-comments -- E2B sends host names to the proxy only when a domain entry allows the connection; `*` with a deny of all IP ranges sends every connection to the proxy by name (README §11a rows 1 and 2). An update replaces the whole config, so each one repeats the proxy.
const networkOf = (proxy: SandboxProvider.Proxy) => ({
  allowOut: ["*"],
  denyOut: ["0.0.0.0/0"],
  egressProxy: { address: proxy.address, username: proxy.username, password: Redacted.value(proxy.password) },
})

const createTimeout = Duration.minutes(10)

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

const runTypes = ["sandbox.lifecycle.paused", "sandbox.lifecycle.killed"] as const

// oxlint-disable-next-line ren/no-comments -- E2B closes each run of a sandbox with one paused or killed event. A kill of a paused sandbox sends no event: its pause closed the run.
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

// oxlint-disable-next-line ren/no-comments -- A run of a brain's sandbox: the tags Ren set at create, and E2B's measure of the run.
const Measured = Schema.Struct({
  sandbox_metadata: Schema.Struct({
    owner: Schema.String,
    brain: Brain.ID,
    generation: Schema.NumberFromString,
    organization: Auth.OrganizationID,
    space: Space.ID,
  }),
  execution: Schema.Struct({ execution_time: Schema.Int, vcpu_count: Schema.Int, memory_mb: Schema.Int }),
})

const pageSize = 100

const failed = (operation: string) => (error: { readonly message: string }) =>
  new SandboxProvider.Failed({ message: `E2B ${operation}: ${error.message}` })

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`

export const layer = Layer.effect(
  SandboxProvider.Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      key: Config.Redacted("E2B_API_KEY"),
      template: Config.String("E2B_TEMPLATE").pipe(Config.withDefault("ren-brain-dev")),
      api: Config.String("E2B_API_URL").pipe(Config.withDefault("https://api.e2b.dev")),
      domain: Config.String("E2B_DOMAIN").pipe(Config.withDefault("e2b.app")),
      port: Config.Int("BRAIN_PORT").pipe(Config.withDefault(4800)),
      maxRunning: Config.Int("SANDBOX_MAX_RUNNING").pipe(Config.withDefault(10)),
      owner: Config.String("E2B_OWNER").pipe(Config.withDefault(defaultOwner)),
      vcpuSecond: Config.Number("E2B_VCPU_SECOND_MICRO_USD").pipe(Config.withDefault(14)),
      gibSecond: Config.Number("E2B_GIB_SECOND_MICRO_USD").pipe(Config.withDefault(4.5)),
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
    const read = (binding: Schema.Json) =>
      Schema.decodeUnknownEffect(Binding)(binding).pipe(Effect.mapError(failed("binding")))
    const body = Effect.fnUntraced(function* (operation: string, response: HttpClientResponse.HttpClientResponse) {
      const text = yield* response.text.pipe(Effect.mapError(failed(operation)))
      if (response.status >= 200 && response.status < 300) return text
      if (response.status === 429)
        return yield* new SandboxProvider.Capacity({
          message: `E2B ${operation} answered 429: ${text.slice(0, 300)}`,
          retryAfter: Duration.seconds(Number(response.headers["retry-after"] ?? "10") || 10),
        })
      return yield* new SandboxProvider.Failed({
        message: `E2B ${operation} answered ${response.status}: ${text.slice(0, 300)}`,
      })
    })
    const strict = (operation: string, response: HttpClientResponse.HttpClientResponse) =>
      body(operation, response).pipe(
        Effect.catchTag("SandboxProvider.Capacity", (error) => Effect.fail(failed(operation)(error))),
      )
    const send = (operation: string, request: HttpClientRequest.HttpClientRequest) =>
      api.execute(request).pipe(Effect.timeout("60 seconds"), Effect.mapError(failed(operation)))
    const gone = (binding: Binding) =>
      new SandboxProvider.Gone({ message: `E2B sandbox ${binding.sandboxId} does not exist` })
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
      proxy: Option.Option<SandboxProvider.Proxy>,
    ) {
      const ca = Option.flatMap(proxy, (found) => found.ca)
      if (Option.isSome(ca)) yield* upload(binding, accessToken, caFile, ca.value)
      const content = Object.keys(env)
        .map((name) => `${name}=${quote(env[name] ?? "")}`)
        .join("\n")
      yield* upload(binding, accessToken, envFile, `${content}\n`)
    })
    const updateNetwork = Effect.fn("E2BSandbox.updateNetwork")(function* (
      binding: Binding,
      proxy: Option.Option<SandboxProvider.Proxy>,
    ) {
      if (Option.isNone(proxy)) return
      const response = yield* send(
        "network",
        HttpClientRequest.put(`/sandboxes/${binding.sandboxId}/network`).pipe(
          HttpClientRequest.bodyJsonUnsafe(networkOf(proxy.value)),
        ),
      )
      if (response.status === 404) return yield* gone(binding)
      yield* strict("network", response)
    })

    return SandboxProvider.Service.of({
      kind: "e2b",
      canEgress: true,
      canMount: true,
      template: config.template,
      create: Effect.fn("E2BSandbox.create")(function* (input) {
        const metadata = { brain: input.brainId, generation: String(input.generation) }
        const existing = (yield* list(metadata, "running,paused")).at(0)
        if (existing) {
          const binding = { sandboxId: existing.sandboxID, domain: config.domain, port: config.port }
          yield* updateNetwork(binding, input.proxy).pipe(
            Effect.catchTag("SandboxProvider.Gone", (error) => Effect.fail(failed("network")(error))),
          )
          return { binding: Schema.encodeSync(Binding)(binding), url: urlOf(binding) }
        }
        const running = yield* list({}, "running")
        if (running.length >= config.maxRunning)
          return yield* new SandboxProvider.Capacity({
            message: `${running.length} development sandboxes run; the limit is ${config.maxRunning} (SANDBOX_MAX_RUNNING)`,
            retryAfter: Duration.seconds(30),
          })
        const response = yield* send(
          "create",
          HttpClientRequest.post("/sandboxes").pipe(
            HttpClientRequest.bodyJsonUnsafe({
              templateID: config.template,
              timeout: Duration.toSeconds(createTimeout),
              autoPause: true,
              secure: true,
              metadata: { owner, ...metadata, organization: input.organizationId, space: input.spaceId },
              envVars: input.env,
              ...Option.match(input.proxy, { onNone: () => ({}), onSome: (proxy) => ({ network: networkOf(proxy) }) }),
            }),
          ),
        )
        const created = yield* body("create", response).pipe(
          Effect.flatMap((text) =>
            Schema.decodeUnknownEffect(Schema.fromJsonString(Created))(text).pipe(Effect.mapError(failed("create"))),
          ),
        )
        const binding = { sandboxId: created.sandboxID, domain: created.domain ?? config.domain, port: config.port }
        yield* configure(binding, Option.fromNullishOr(created.envdAccessToken), input.env, input.proxy)
        return { binding: Schema.encodeSync(Binding)(binding), url: urlOf(binding) }
      }),
      connect: Effect.fn("E2BSandbox.connect")(function* (raw, proxy) {
        const binding = yield* read(raw)
        const response = yield* send(
          "connect",
          HttpClientRequest.post(`/sandboxes/${binding.sandboxId}/connect`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ timeout: Duration.toSeconds(createTimeout) }),
          ),
        )
        if (response.status === 404) return yield* gone(binding)
        yield* body("connect", response)
        yield* updateNetwork(binding, proxy)
        return { url: urlOf(binding) }
      }),
      keepAlive: Effect.fn("E2BSandbox.keepAlive")(function* (raw, duration) {
        const binding = yield* read(raw)
        const response = yield* send(
          "timeout",
          HttpClientRequest.post(`/sandboxes/${binding.sandboxId}/timeout`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ timeout: Math.ceil(Duration.toSeconds(duration)) }),
          ),
        )
        if (response.status === 404) return yield* gone(binding)
        yield* strict("timeout", response)
      }),
      destroy: Effect.fn("E2BSandbox.destroy")(function* (raw) {
        const binding = yield* read(raw)
        const response = yield* send("kill", HttpClientRequest.delete(`/sandboxes/${binding.sandboxId}`))
        if (response.status === 404) return
        yield* strict("kill", response)
      }),
      status: Effect.fn("E2BSandbox.status")(function* (raw) {
        const binding = yield* read(raw)
        const response = yield* send("info", HttpClientRequest.get(`/sandboxes/${binding.sandboxId}`))
        if (response.status === 404) return "gone" as const
        const text = yield* strict("info", response)
        const detail = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Detail))(text).pipe(
          Effect.mapError(failed("info")),
        )
        return detail.state === "paused" ? ("paused" as const) : ("running" as const)
      }),
      metered: Effect.fn("E2BSandbox.metered")(function* (since) {
        const older = (run: Run) => Option.exists(since, (time) => DateTime.isLessThan(run.timestamp, time))
        // oxlint-disable-next-line ren/no-comments -- Newest first: a run that ends while Ren reads moves the older ones down one place, so a page can repeat a run but never skips one. Usage ignores the repeat.
        const runsFrom = (offset: number): Effect.Effect<ReadonlyArray<Run>, SandboxProvider.Failed> =>
          Effect.flatMap(page(offset), (runs) =>
            runs.length < pageSize || runs.some(older)
              ? Effect.succeed(runs)
              : Effect.map(runsFrom(offset + pageSize), (rest) => [...runs, ...rest]),
          )
        return (yield* runsFrom(0)).flatMap((run) => {
          const measured = Schema.decodeUnknownOption(Measured)(run.eventData)
          if (older(run) || Option.isNone(measured) || measured.value.sandbox_metadata.owner !== owner) return []
          const tags = measured.value.sandbox_metadata
          const execution = measured.value.execution
          const vcpuMs = execution.vcpu_count * execution.execution_time
          const memoryMibMs = execution.memory_mb * execution.execution_time
          return [
            {
              id: run.id,
              sandboxId: run.sandboxId,
              brainId: tags.brain,
              generation: tags.generation,
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
      lost: Stream.empty,
      hand: () => Effect.succeed({ url: `http://127.0.0.1:${EnvironmentApi.port}`, workspace: "/home/user/workspace" }),
      list: list({}, "running,paused").pipe(
        Effect.map((sandboxes) =>
          sandboxes.flatMap((sandbox) => {
            const brain = Schema.decodeUnknownOption(Brain.ID)(sandbox.metadata?.brain)
            if (Option.isNone(brain)) return []
            return [
              {
                binding: Schema.encodeSync(Binding)({
                  sandboxId: sandbox.sandboxID,
                  domain: config.domain,
                  port: config.port,
                }),
                brainId: brain.value,
                generation: Number(sandbox.metadata?.generation ?? "0"),
              },
            ]
          }),
        ),
      ),
    })
  }),
)
