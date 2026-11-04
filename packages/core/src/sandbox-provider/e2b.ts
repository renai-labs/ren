export * as E2BSandbox from "./e2b.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { Config, DateTime, Duration, Effect, Layer, Option, Schema, Stream } from "effect"
import { HttpClientRequest } from "effect/http"
import { E2BApi } from "../e2b-api.js"
import { SandboxProvider } from "../sandbox-provider.js"

// oxlint-disable-next-line ren/no-comments -- Sandboxes are tagged with the Ren that made them. One E2B team can serve several Rens (developers); each lists, counts and cleans up only its own (E2B_OWNER).
export const defaultOwner = "ren-v2-dev"

const envFile = "/home/user/.ren/brain.env"

export const caFile = "/home/user/.ren/egress-ca.pem"

const networkOf = (proxy: SandboxProvider.Proxy) =>
  E2BApi.networkOf({ hosts: Option.none(), proxy: Option.some(proxy) })

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

export const layer = Layer.effect(
  SandboxProvider.Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      e2b: E2BApi.config,
      template: Config.String("E2B_TEMPLATE").pipe(Config.withDefault("ren-brain-dev")),
      port: Config.Int("BRAIN_PORT").pipe(Config.withDefault(4800)),
      maxRunning: Config.Int("SANDBOX_MAX_RUNNING").pipe(Config.withDefault(10)),
      owner: Config.String("E2B_OWNER").pipe(Config.withDefault(defaultOwner)),
      vcpuSecond: Config.Number("E2B_VCPU_SECOND_MICRO_USD"),
      gibSecond: Config.Number("E2B_GIB_SECOND_MICRO_USD"),
    })
    const owner = config.owner
    const e2b = yield* E2BApi.make(config.e2b)
    const urlOf = (binding: Binding) => `https://${binding.port}-${binding.sandboxId}.${binding.domain}`
    const read = (binding: Schema.Json) =>
      Schema.decodeUnknownEffect(Binding)(binding).pipe(Effect.mapError(failed("binding")))
    const refused = (operation: string, answer: Exclude<E2BApi.Answer, { readonly _tag: "Ok" }>) =>
      new SandboxProvider.Failed({
        message: `E2B ${operation} answered ${answer.status}: ${answer.text.slice(0, 300)}`,
      })
    const body = (
      operation: string,
      answer: E2BApi.Answer,
    ): Effect.Effect<string, SandboxProvider.Failed | SandboxProvider.Capacity> => {
      if (answer._tag === "Ok") return Effect.succeed(answer.text)
      if (answer._tag === "Busy")
        return Effect.fail(
          new SandboxProvider.Capacity({
            message: `E2B ${operation} answered 429: ${answer.text.slice(0, 300)}`,
            retryAfter: answer.retryAfter,
          }),
        )
      return Effect.fail(refused(operation, answer))
    }
    const strict = (operation: string, answer: E2BApi.Answer): Effect.Effect<string, SandboxProvider.Failed> =>
      answer._tag === "Ok" ? Effect.succeed(answer.text) : Effect.fail(refused(operation, answer))
    const send = (operation: string, request: Effect.Effect<E2BApi.Answer, { readonly message: string }>) =>
      request.pipe(Effect.mapError(failed(operation)))
    const gone = (binding: Binding) =>
      new SandboxProvider.Gone({ message: `E2B sandbox ${binding.sandboxId} does not exist` })
    const list = (metadata: Readonly<Record<string, string>>, state: string) =>
      send(
        "list",
        e2b.send(
          HttpClientRequest.get("/v2/sandboxes").pipe(
            HttpClientRequest.setUrlParams({
              metadata: new URLSearchParams({ owner, ...metadata }).toString(),
              state,
            }),
          ),
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
        e2b.send(
          HttpClientRequest.get("/events/sandboxes").pipe(
            HttpClientRequest.setUrlParams({ types: runTypes, limit: pageSize, offset }),
          ),
        ),
      ).pipe(
        Effect.flatMap((response) => strict("events", response)),
        Effect.flatMap((text) =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(Runs))(text).pipe(Effect.mapError(failed("events"))),
        ),
      )
    const upload = (binding: Binding, accessToken: Option.Option<string>, path: string, content: string) =>
      send("configure", e2b.upload(binding, accessToken, path, content)).pipe(
        Effect.flatMap((answer) => strict("configure", answer)),
      )
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
        .map((name) => `${name}=${E2BApi.quote(env[name] ?? "")}`)
        .join("\n")
      yield* upload(binding, accessToken, envFile, `${content}\n`)
    })
    const updateNetwork = Effect.fn("E2BSandbox.updateNetwork")(function* (
      binding: Binding,
      proxy: Option.Option<SandboxProvider.Proxy>,
    ) {
      if (Option.isNone(proxy)) return
      const answer = yield* send("network", e2b.updateNetwork(binding.sandboxId, networkOf(proxy.value)))
      if (answer._tag === "Missing") return yield* gone(binding)
      yield* strict("network", answer)
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
          const binding = { sandboxId: existing.sandboxID, domain: e2b.domain, port: config.port }
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
        const answer = yield* send(
          "create",
          e2b.create({
            templateID: config.template,
            timeout: Duration.toSeconds(createTimeout),
            autoPause: true,
            secure: true,
            metadata: { owner, ...metadata, organization: input.organizationId, space: input.spaceId },
            envVars: input.env,
            ...Option.match(input.proxy, { onNone: () => ({}), onSome: (proxy) => ({ network: networkOf(proxy) }) }),
          }),
        )
        const created = yield* body("create", answer).pipe(
          Effect.flatMap((text) =>
            Schema.decodeUnknownEffect(Schema.fromJsonString(Created))(text).pipe(Effect.mapError(failed("create"))),
          ),
        )
        const binding = { sandboxId: created.sandboxID, domain: created.domain ?? e2b.domain, port: config.port }
        yield* configure(binding, Option.fromNullishOr(created.envdAccessToken), input.env, input.proxy)
        return { binding: Schema.encodeSync(Binding)(binding), url: urlOf(binding) }
      }),
      connect: Effect.fn("E2BSandbox.connect")(function* (raw, proxy) {
        const binding = yield* read(raw)
        const answer = yield* send("connect", e2b.connect(binding.sandboxId, createTimeout))
        if (answer._tag === "Missing") return yield* gone(binding)
        yield* body("connect", answer)
        yield* updateNetwork(binding, proxy)
        return { url: urlOf(binding) }
      }),
      keepAlive: Effect.fn("E2BSandbox.keepAlive")(function* (raw, duration) {
        const binding = yield* read(raw)
        const answer = yield* send("timeout", e2b.keepAlive(binding.sandboxId, duration))
        if (answer._tag === "Missing") return yield* gone(binding)
        yield* strict("timeout", answer)
      }),
      destroy: Effect.fn("E2BSandbox.destroy")(function* (raw) {
        const binding = yield* read(raw)
        const answer = yield* send("kill", e2b.kill(binding.sandboxId))
        if (answer._tag === "Missing") return
        yield* strict("kill", answer)
      }),
      status: Effect.fn("E2BSandbox.status")(function* (raw) {
        const binding = yield* read(raw)
        const answer = yield* send("info", e2b.info(binding.sandboxId))
        if (answer._tag === "Missing") return "gone" as const
        const text = yield* strict("info", answer)
        const detail = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Detail))(text).pipe(
          Effect.mapError(failed("info")),
        )
        return detail.state === "paused" ? ("paused" as const) : ("running" as const)
      }),
      metered: Effect.fn("E2BSandbox.metered")(function* (since) {
        const older = (run: Run) => Option.exists(since, (time) => DateTime.isLessThan(run.timestamp, time))
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
                  domain: e2b.domain,
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
