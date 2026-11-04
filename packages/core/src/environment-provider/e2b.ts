export * as E2BEnvironment from "./e2b.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { App } from "@ren/schema/app"
import { Identifier } from "@ren/schema/identifier"
import { Config, Duration, Effect, Option, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { E2BApi } from "../e2b-api.js"
import { EnvironmentProvider } from "../environment-provider.js"
import { E2BSandbox } from "../sandbox-provider/e2b.js"

const TemplateConfig = Schema.Struct({
  cpuCount: Schema.Literals([1, 2, 4, 6, 8])
    .annotate({ title: "CPUs", description: "E2B fixes the size of a sandbox when it builds the image." })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed(2 as const))),
  memoryMiB: Schema.Literals([1024, 2048, 4096, 6144, 8192])
    .annotate({ title: "Memory (MiB)" })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed(2048 as const))),
  ...App.Environment.fields,
}).annotate({ title: "E2B" })

const Binding = Schema.Struct({ sandboxId: Schema.NonEmptyString, domain: Schema.NonEmptyString })

const Created = Schema.Struct({
  sandboxID: Schema.String,
  domain: Schema.optional(Schema.NullOr(Schema.String)),
  envdAccessToken: Schema.optional(Schema.NullOr(Schema.String)),
})

const Listed = Schema.Array(Schema.Struct({ sandboxID: Schema.String }))

const Requested = Schema.Struct({ templateID: Schema.String, buildID: Schema.String })

const Status = Schema.Struct({
  status: Schema.String,
  reason: Schema.optional(Schema.NullOr(Schema.Struct({ message: Schema.optional(Schema.String) }))),
})

const envFile = "/home/user/.ren/environment.env"

const startCommand = "/opt/ren/environment-start.sh"

const readyCommand = `pgrep -f ${startCommand}`

const awakeAtStart = Duration.minutes(30)

const buildCheckedEvery = Duration.seconds(5)

const buildWithin = Duration.minutes(45)

// oxlint-disable-next-line ren/no-comments -- ren-v1's commands (ren-v1 packages/app/src/lib/environment-config.ts:12-26), one RUN each, as root; a build command runs as the sandbox user, who has sudo.
const stepsOf = (config: typeof TemplateConfig.Type) => {
  const packages = (names: ReadonlyArray<string> | undefined) => (names ?? []).map(E2BApi.quote).join(" ")
  const root = (command: string) => ({ type: "RUN", args: [command, "root"], force: false })
  return [
    ...(config.packages.apt?.length
      ? [root(`apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${packages(config.packages.apt)}`)]
      : []),
    ...(config.packages.npm?.length ? [root(`npm install -g ${packages(config.packages.npm)}`)] : []),
    ...(config.packages.pip?.length
      ? [root(`pip install --break-system-packages ${packages(config.packages.pip)}`)]
      : []),
    ...(config.packages.go ?? []).map((name) => root(`GOBIN=/usr/local/bin go install ${E2BApi.quote(name)}`)),
    ...config.buildCommands.map((command) => ({ type: "RUN", args: [command, "user"], force: false })),
  ]
}

export const provider = Effect.gen(function* () {
  const settings = yield* Config.all({
    e2b: E2BApi.config,
    base: Config.String("E2B_ENVIRONMENT_BASE"),
    owner: Config.String("E2B_OWNER").pipe(Config.withDefault(E2BSandbox.defaultOwner)),
    egress: Config.option(Config.String("EGRESS_PROXY_ADDRESS")),
  })
  const e2b = yield* E2BApi.make(settings.e2b)
  const http = yield* HttpClient.HttpClient
  const failed = (operation: string) => (error: { readonly message: string }) =>
    new EnvironmentProvider.Failed({ message: `E2B ${operation}: ${error.message}` })
  const ok = (operation: string, answer: E2BApi.Answer) =>
    answer._tag === "Ok"
      ? Effect.succeed(answer.text)
      : Effect.fail(
          new EnvironmentProvider.Failed({
            message: `E2B ${operation} answered ${answer.status}: ${answer.text.slice(0, 300)}`,
          }),
        )
  const call = (operation: string, request: Effect.Effect<E2BApi.Answer, { readonly message: string }>) =>
    request.pipe(Effect.mapError(failed(operation)))
  const decode =
    <A>(operation: string, schema: Schema.Codec<A, unknown>) =>
    (text: string) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(Effect.mapError(failed(operation)))
  const gone = (binding: typeof Binding.Type) =>
    new EnvironmentProvider.Gone({ message: `E2B sandbox ${binding.sandboxId} does not exist` })
  const urlOf = (binding: typeof Binding.Type) =>
    new URL(`https://${EnvironmentApi.port}-${binding.sandboxId}.${binding.domain}`)
  const updateNetwork = Effect.fn("E2BEnvironment.updateNetwork")(function* (
    binding: typeof Binding.Type,
    network: EnvironmentProvider.Network,
  ) {
    const answer = yield* call("network", e2b.updateNetwork(binding.sandboxId, E2BApi.networkOf(network)))
    if (answer._tag === "Missing") return yield* gone(binding)
    yield* ok("network", answer)
  })

  return EnvironmentProvider.make({
    id: EnvironmentProvider.ID.make("e2b"),
    title: "E2B",
    description:
      "A sandbox on E2B, made from an image that Ren builds from the template: packages, build commands, CPU and memory. It pauses when no chat uses it and keeps its files.",
    egress: Option.isSome(settings.egress),
    canMount: false,
    canLimitHosts: true,
    config: TemplateConfig,
    binding: Binding,
    build: {
      base: settings.base,
      run: Effect.fn("E2BEnvironment.build")(function* (input) {
        const name = `ren-environment-${Identifier.suffix(input.environmentTemplateId).toLowerCase()}`
        const requested = yield* call(
          "build",
          e2b.send(
            HttpClientRequest.post("/v3/templates").pipe(
              HttpClientRequest.bodyJsonUnsafe({
                name,
                tags: [input.tag],
                cpuCount: input.config.cpuCount,
                memoryMB: input.config.memoryMiB,
              }),
            ),
          ),
        ).pipe(
          Effect.flatMap((answer) => ok("build", answer)),
          Effect.flatMap(decode("build", Requested)),
        )
        yield* call(
          "build",
          e2b.send(
            HttpClientRequest.post(`/v2/templates/${requested.templateID}/builds/${requested.buildID}`).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                fromTemplate: settings.base,
                steps: stepsOf(input.config),
                startCmd: startCommand,
                readyCmd: readyCommand,
                force: false,
              }),
            ),
          ),
        ).pipe(Effect.flatMap((answer) => ok("build", answer)))
        const finished = yield* call(
          "build status",
          e2b.send(HttpClientRequest.get(`/templates/${requested.templateID}/builds/${requested.buildID}/status`)),
        ).pipe(
          Effect.flatMap((answer) => ok("build status", answer)),
          Effect.flatMap(decode("build status", Status)),
          Effect.repeat({
            schedule: Schedule.spaced(buildCheckedEvery),
            until: (status) => status.status === "ready" || status.status === "error",
          }),
          Effect.timeoutOrElse({
            duration: buildWithin,
            orElse: () =>
              Effect.fail(
                new EnvironmentProvider.Failed({
                  message: `The build did not end within ${Duration.format(buildWithin)}`,
                }),
              ),
          }),
        )
        if (finished.status === "error")
          return yield* new EnvironmentProvider.Failed({ message: finished.reason?.message ?? "The build failed" })
        return `${name}:${input.tag}`
      }),
    },
    provision: Effect.fn("E2BEnvironment.provision")(function* (input) {
      if (Option.isNone(input.image))
        return yield* new EnvironmentProvider.Failed({ message: "The template has no image that built" })
      const metadata = { owner: settings.owner, environment: input.environmentId }
      const existing = yield* call(
        "list",
        e2b.send(
          HttpClientRequest.get("/v2/sandboxes").pipe(
            HttpClientRequest.setUrlParams({
              metadata: new URLSearchParams(metadata).toString(),
              state: "running,paused",
            }),
          ),
        ),
      ).pipe(
        Effect.flatMap((answer) => ok("list", answer)),
        Effect.flatMap(decode("list", Listed)),
      )
      const found = existing.at(0)
      if (found) return { sandboxId: found.sandboxID, domain: e2b.domain }
      const created = yield* call(
        "create",
        e2b.create({
          templateID: input.image.value,
          timeout: Duration.toSeconds(awakeAtStart),
          autoPause: true,
          secure: true,
          metadata,
          network: E2BApi.networkOf(input.network),
        }),
      ).pipe(
        Effect.flatMap((answer) => ok("create", answer)),
        Effect.flatMap(decode("create", Created)),
      )
      const binding = { sandboxId: created.sandboxID, domain: created.domain ?? e2b.domain }
      const accessToken = Option.fromNullishOr(created.envdAccessToken)
      const ca = Option.flatMap(input.network.proxy, (proxy) => proxy.ca)
      // oxlint-disable-next-line ren/no-comments -- The CA goes before the env file, because the start script installs it once the env file exists (C44).
      if (Option.isSome(ca))
        yield* call("configure", e2b.upload(binding, accessToken, E2BSandbox.caFile, ca.value)).pipe(
          Effect.flatMap((answer) => ok("configure", answer)),
        )
      const env = Object.entries(input.variables)
        .map((entry) => `${entry[0]}=${E2BApi.quote(entry[1])}`)
        .join("\n")
      yield* call("configure", e2b.upload(binding, accessToken, envFile, `${env}\n`)).pipe(
        Effect.flatMap((answer) => ok("configure", answer)),
      )
      return binding
    }),
    connect: Effect.fn("E2BEnvironment.connect")(function* (binding, network) {
      const answer = yield* call("connect", e2b.connect(binding.sandboxId, awakeAtStart))
      if (answer._tag === "Missing") return yield* gone(binding)
      yield* ok("connect", answer)
      yield* updateNetwork(binding, network)
      const url = urlOf(binding)
      yield* EnvironmentProvider.waitForExecutor(http, url)
      return { url }
    }),
    keepAlive: Effect.fn("E2BEnvironment.keepAlive")(function* (binding, duration) {
      const answer = yield* call("timeout", e2b.keepAlive(binding.sandboxId, duration))
      if (answer._tag === "Missing") return yield* gone(binding)
      yield* ok("timeout", answer)
    }),
    updateNetwork,
    destroy: Effect.fn("E2BEnvironment.destroy")(function* (binding) {
      const answer = yield* call("kill", e2b.kill(binding.sandboxId))
      if (answer._tag === "Missing") return
      yield* ok("kill", answer)
    }),
  })
})
