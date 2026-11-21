export * as ArtifactWorkerd from "./workerd.js"

import { Artifact } from "@ren/schema/artifact"
import { Config, Duration, Effect, Layer, Option, Result, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { mkdir, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ArtifactProvider } from "../artifact-provider.js"
import { ArtifactArchive } from "../artifact-archive.js"
import { ArtifactDurableObjects } from "./durable-objects.js"
import { ObjectStorage } from "../object-storage.js"

export const id = Artifact.ProviderID.make("workerd")

const compatibilityDate = "2025-10-01"

const servesWithin = Duration.seconds(60)

const stopsWithin = Duration.seconds(10)

const Remote = Schema.Struct({ directory: Schema.String, port: Schema.Int, path: Schema.String })

const Serving = Schema.fromJsonString(
  Schema.Struct({ pid: Schema.Int, port: Schema.Int, deploymentId: Artifact.DeploymentID }),
)

const servingFile = (directory: string) => join(directory, "serving.json")

const portFile = (directory: string) => join(directory, "port")

const Port = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))

const readServing = (directory: string) =>
  Effect.promise(() =>
    Bun.file(servingFile(directory))
      .text()
      .catch(() => ""),
  ).pipe(Effect.map(Schema.decodeUnknownOption(Serving)))

const failed = (error: unknown) =>
  error instanceof ArtifactProvider.Failed
    ? error
    : new ArtifactProvider.Failed({ message: error instanceof Error ? error.message : String(error), retryable: false })

const write = (path: string, text: string) =>
  Effect.tryPromise({ try: () => Bun.write(path, text), catch: failed }).pipe(Effect.asVoid)

const isAlive = (pid: number) => Effect.try(() => process.kill(pid, 0)).pipe(Effect.isSuccess)

const signal = (pid: number, name: NodeJS.Signals) => Effect.try(() => process.kill(-pid, name)).pipe(Effect.ignore)

const stop = Effect.fnUntraced(function* (pid: number) {
  yield* signal(pid, "SIGTERM")
  const exited = yield* isAlive(pid).pipe(
    Effect.repeat({ schedule: Schedule.spaced("100 millis"), until: (alive) => !alive }),
    Effect.timeoutOption(stopsWithin),
  )
  if (Option.isNone(exited)) yield* signal(pid, "SIGKILL")
})

// oxlint-disable-next-line ren/no-comments -- The whole budget of one call: a start that does not serve, and the stop that follows it.
const budget = Duration.sum(servesWithin, stopsWithin)

const budgeted = <A>(call: Effect.Effect<A, ArtifactProvider.Failed>) =>
  call.pipe(
    Effect.timeoutOrElse({
      duration: budget,
      orElse: () =>
        Effect.fail(
          new ArtifactProvider.Failed({
            message: `The deployment did not finish within ${Duration.format(budget)}`,
            retryable: false,
          }),
        ),
    }),
  )

const freePort = Effect.sync(() => {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => undefined } })
  const port = listener.port
  listener.stop(true)
  return port
})

export const layer = Layer.effect(
  ArtifactProvider.Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      root: Config.String("ARTIFACT_ROOT").pipe(Config.withDefault(join(tmpdir(), "ren-artifacts"))),
      host: Config.String("ARTIFACT_HOST").pipe(Config.withDefault("127.0.0.1")),
      node: Config.String("ARTIFACT_NODE").pipe(Config.withDefault("node")),
    })
    const http = yield* HttpClient.HttpClient
    const storage = yield* ObjectStorage.Service
    const wrangler = join(dirname(fileURLToPath(import.meta.resolve("wrangler/package.json"))), "wrangler-dist/cli.js")

    const answers = (port: number) =>
      http.execute(HttpClientRequest.get(`http://127.0.0.1:${port}/`)).pipe(
        Effect.timeout("2 seconds"),
        Effect.map((response) => response.status < 500),
        Effect.orElseSucceed(() => false),
      )

    const start = Effect.fnUntraced(function* (directory: string, deploymentId: Artifact.DeploymentID, port: number) {
      const deploymentDirectory = join(directory, "deployments", deploymentId)
      const log = join(directory, `${deploymentId}.log`)
      const output = yield* Effect.try({ try: () => openSync(log, "a"), catch: failed })
      const child = yield* Effect.try({
        try: () =>
          spawn(
            config.node,
            [
              wrangler,
              "dev",
              "--config",
              join(deploymentDirectory, "wrangler.json"),
              "--ip",
              "127.0.0.1",
              "--port",
              String(port),
              "--inspector-port",
              "0",
              "--persist-to",
              join(directory, "state"),
            ],
            {
              cwd: deploymentDirectory,
              detached: true,
              stdio: ["ignore", output, output],
              env: {
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                WRANGLER_SEND_METRICS: "false",
                BROWSER: "none",
                CI: "1",
              },
            },
          ),
        catch: (error) =>
          new ArtifactProvider.Failed({
            message: `wrangler did not start: ${failed(error).message}`,
            retryable: false,
          }),
      }).pipe(Effect.ensuring(Effect.sync(() => closeSync(output))))
      const pid = yield* Effect.callback<number, ArtifactProvider.Failed>((resume) => {
        child.on("error", (error) =>
          resume(
            Effect.fail(
              new ArtifactProvider.Failed({ message: `wrangler did not start: ${error.message}`, retryable: false }),
            ),
          ),
        )
        child.once("spawn", () =>
          resume(
            child.pid
              ? Effect.succeed(child.pid)
              : Effect.fail(new ArtifactProvider.Failed({ message: "wrangler did not start", retryable: false })),
          ),
        )
      })
      child.unref()
      yield* write(servingFile(directory), Schema.encodeSync(Serving)({ pid, port, deploymentId }))
      const state = yield* Effect.gen(function* () {
        if (!(yield* isAlive(pid))) return "exited"
        return (yield* answers(port)) ? "serving" : "starting"
      }).pipe(
        Effect.repeat({ schedule: Schedule.spaced("200 millis"), until: (state) => state !== "starting" }),
        Effect.timeoutOption(servesWithin),
        Effect.onInterrupt(() => stop(pid)),
      )
      if (Option.contains(state, "serving"))
        return yield* write(servingFile(directory), Schema.encodeSync(Serving)({ pid, port, deploymentId }))
      yield* stop(pid)
      const written = yield* Effect.tryPromise({ try: () => Bun.file(log).text(), catch: failed })
      return yield* new ArtifactProvider.Failed({
        message: `The deployment did not serve on port ${port}:\n${written.slice(-2000)}`,
        retryable: false,
      })
    })

    return ArtifactProvider.make({
      id,
      remote: Remote,
      deploy: Effect.fn("ArtifactWorkerd.deploy")(function* (input) {
        const files = (yield* ArtifactArchive.read(storage, input.archive).pipe(Effect.mapError(failed))).files
        const directory = join(config.root, input.artifactId)
        const desired = input.config.durableObjects ?? {}
        const savedObjects = Bun.file(join(directory, "durable-objects.json"))
        const previousObjects = (yield* Effect.tryPromise({ try: () => savedObjects.exists(), catch: failed }))
          ? yield* Effect.tryPromise({ try: () => savedObjects.text(), catch: failed }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Artifact.DurableObjects))),
              Effect.mapError(failed),
            )
          : {}
        const allowed = ArtifactDurableObjects.bindings({
          active: previousObjects,
          retained: previousObjects,
          desired,
        })
        if (Result.isFailure(allowed))
          return yield* new ArtifactProvider.Failed({ message: allowed.failure, retryable: false })
        const objects = allowed.success
        const before = yield* readServing(directory)
        const kept = yield* Effect.promise(() =>
          Bun.file(portFile(directory))
            .text()
            .catch(() => ""),
        ).pipe(Effect.map(Schema.decodeUnknownOption(Port)))
        const port = Option.isSome(input.remote)
          ? input.remote.value.port
          : yield* Option.match(
              Option.orElse(
                Option.map(before, (serving) => serving.port),
                () => kept,
              ),
              {
                onNone: () => freePort,
                onSome: Effect.succeed,
              },
            )
        yield* write(portFile(directory), String(port))
        const remote = { directory, port, path: ArtifactProvider.entryPath(input.config) }
        const url = `http://${config.host}:${port}${remote.path}`
        const saveObjects = Effect.tryPromise({
          try: async () => {
            const temporary = join(directory, `${input.deploymentId}.objects.json`)
            await Bun.write(temporary, JSON.stringify(objects))
            await rename(temporary, join(directory, "durable-objects.json"))
          },
          catch: failed,
        })
        if (Option.exists(before, (serving) => serving.deploymentId === input.deploymentId) && (yield* answers(port))) {
          yield* saveObjects
          return { remote, url }
        }
        const deploymentDirectory = join(directory, "deployments", input.deploymentId)
        const worker = Object.hasOwn(files, Artifact.workerPath)
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(join(deploymentDirectory, "public"), { recursive: true })
            await Promise.all(
              Object.keys(files).map((path) =>
                Bun.write(
                  path === Artifact.workerPath
                    ? join(deploymentDirectory, path)
                    : join(deploymentDirectory, "public", path),
                  files[path] ?? new Uint8Array(),
                ),
              ),
            )
            await Bun.write(
              join(deploymentDirectory, "wrangler.json"),
              JSON.stringify({
                name: input.artifactId.toLowerCase().replaceAll("_", "-"),
                compatibility_date: compatibilityDate,
                ...(worker && { main: Artifact.workerPath, no_bundle: true }),
                assets: { directory: "public", ...(worker && { binding: "ASSETS" }) },
                durable_objects: {
                  code_update_strategy: { mode: "immediate" },
                  bindings: Object.entries(objects).map(([name, className]) => ({ name, class_name: className })),
                },
                exports: ArtifactDurableObjects.exports(objects),
              }),
            )
          },
          catch: failed,
        })
        if (Option.isSome(before)) yield* stop(before.value.pid)
        yield* start(directory, input.deploymentId, port).pipe(
          Effect.andThen(saveObjects),
          Effect.onInterrupt(() =>
            Option.isSome(before) && before.value.deploymentId !== input.deploymentId
              ? start(directory, before.value.deploymentId, port).pipe(Effect.ignore)
              : Effect.void,
          ),
          Effect.tapError(() =>
            Effect.gen(function* () {
              const candidate = yield* readServing(directory)
              if (Option.isSome(candidate)) yield* stop(candidate.value.pid)
              if (Option.isSome(before)) yield* start(directory, before.value.deploymentId, port).pipe(Effect.ignore)
            }),
          ),
        )
        return { remote, url }
      }, budgeted),
      stop: Effect.fn("ArtifactWorkerd.stop")(function* (artifactId) {
        const directory = join(config.root, artifactId)
        const serving = yield* readServing(directory)
        if (Option.isSome(serving)) yield* stop(serving.value.pid)
        yield* Effect.tryPromise({
          try: () => rm(servingFile(directory), { force: true }),
          catch: failed,
        })
      }, budgeted),
    })
  }),
).pipe(Layer.provide(ObjectStorage.layer))
