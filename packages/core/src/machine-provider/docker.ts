export * as Docker from "./docker.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Duration, Effect, Option, Schedule, Schema, Stream } from "effect"
import { HttpClient } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { EnvironmentProvider } from "../environment-provider.js"
import { MachineProvider } from "../machine-provider.js"

const Config = Schema.Struct({
  image: Schema.NonEmptyString.annotate({
    title: "Image",
    description: `A Docker image that runs Ren’s executor on port ${EnvironmentApi.port}.`,
  }),
  cpus: Schema.optionalKey(
    Schema.Finite.check(Schema.isGreaterThan(0)).annotate({ title: "CPUs", description: "Docker’s --cpus." }),
  ),
  memoryMiB: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 64, maximum: 1_048_576 })).annotate({
      title: "Memory (MiB)",
      description: "Docker’s --memory.",
    }),
  ),
}).annotate({ title: "Docker" })

const Binding = Schema.Struct({ containerId: Schema.NonEmptyString })

const executorPort = `${EnvironmentApi.port}/tcp`

const nameRaceChecks = 100

const nameRaceCheckEvery = Duration.millis(100)

const isMissing = (stderr: string) => /no such (container|object)/iu.test(stderr)

const isNameTaken = (stderr: string) => /is already in use/u.test(stderr)

export const provider = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const http = yield* HttpClient.HttpClient

  const runDocker = (args: ReadonlyArray<string>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(ChildProcess.make("docker", args))
        return yield* Effect.all(
          {
            stdout: handle.stdout.pipe(
              Stream.decodeText,
              Stream.mkString,
              Effect.map((text) => text.trim()),
            ),
            stderr: handle.stderr.pipe(
              Stream.decodeText,
              Stream.mkString,
              Effect.map((text) => text.trim()),
            ),
            exitCode: handle.exitCode,
          },
          { concurrency: "unbounded" },
        )
      }),
    ).pipe(
      Effect.mapError(
        (error) => new MachineProvider.Failed({ message: `docker ${args.at(0) ?? ""}: ${error.message}` }),
      ),
    )

  const containerOf = (name: string) =>
    runDocker(["container", "inspect", "--format", "{{.Id}}", name]).pipe(
      Effect.map((inspected) => (inspected.exitCode === 0 ? Option.some(inspected.stdout) : Option.none())),
    )

  const connect = Effect.fn("Docker.connect")(function* (binding: typeof Binding.Type) {
    const running = yield* runDocker(["container", "inspect", "--format", "{{.State.Running}}", binding.containerId])
    if (running.exitCode !== 0 && isMissing(running.stderr))
      return yield* new MachineProvider.Gone({ message: `The container ${binding.containerId} no longer exists` })
    if (running.exitCode !== 0) return yield* new MachineProvider.Failed({ message: running.stderr })
    if (running.stdout !== "true") {
      const restarted = yield* runDocker(["start", binding.containerId])
      if (restarted.exitCode !== 0) return yield* new MachineProvider.Failed({ message: restarted.stderr })
    }
    const published = yield* runDocker(["port", binding.containerId, executorPort])
    const hostPort = /:(\d+)$/mu.exec(published.stdout)?.at(1)
    if (published.exitCode !== 0 || !hostPort)
      return yield* new MachineProvider.Failed({
        message: `The container ${binding.containerId} publishes no executor port: ${published.stderr}`,
      })
    const url = new URL(`http://127.0.0.1:${hostPort}`)
    yield* MachineProvider.waitForExecutor(http, url)
    return { url: url.href }
  })

  return MachineProvider.make({
    id: EnvironmentProvider.ID.make("docker"),
    title: "Docker",
    description:
      "A container on the machine that runs Ren, made from an image that runs Ren’s executor. For development and self-hosting: its executor listens on 127.0.0.1, so the brain must run on the same machine.",
    // oxlint-disable-next-line ren/no-comments -- A Docker environment has no egress yet, so its processes get no placeholders (R19, §11.1).
    canEgress: false,
    canMount: false,
    canSample: false,
    canColocate: false,
    canLimitHosts: false,
    config: Config,
    binding: Binding,
    create: Effect.fn("Docker.create")(function* (input) {
      // oxlint-disable-next-line ren/no-comments -- EN34: one container per id and generation, so a replace whose destroy failed never gets the old container back.
      const name = `ren-${input.labels.id}-${input.labels.generation}`
      const containerId = yield* Effect.gen(function* () {
        const existing = yield* containerOf(name)
        if (Option.isSome(existing)) return existing.value
        const started = yield* runDocker([
          "run",
          "--detach",
          "--init",
          "--name",
          name,
          "--label",
          `ren.environment=${input.labels.id}`,
          "--publish",
          `127.0.0.1::${executorPort}`,
          ...Object.entries(input.variables).flatMap(([variable, value]) => ["--env", `${variable}=${value}`]),
          ...(input.config.cpus ? ["--cpus", String(input.config.cpus)] : []),
          ...(input.config.memoryMiB ? ["--memory", `${input.config.memoryMiB}m`] : []),
          input.config.image,
        ])
        if (started.exitCode === 0) return started.stdout
        if (!isNameTaken(started.stderr))
          return yield* new MachineProvider.Failed({ message: `docker run ${input.config.image}: ${started.stderr}` })
        // oxlint-disable-next-line ren/no-comments -- Another call for this environment holds the name; Docker shows its container only after it is made.
        return yield* containerOf(name).pipe(
          Effect.flatMap(
            Option.match({
              onSome: Effect.succeed,
              onNone: () =>
                Effect.fail(
                  new MachineProvider.Failed({ message: `Another call is still making the container ${name}` }),
                ),
            }),
          ),
          Effect.retry({ schedule: Schedule.spaced(nameRaceCheckEvery), times: nameRaceChecks }),
        )
      })
      const connected = yield* connect({ containerId }).pipe(
        Effect.catchTag("MachineProvider.Gone", (error) =>
          Effect.fail(new MachineProvider.Failed({ message: error.message })),
        ),
      )
      return { binding: { containerId }, url: connected.url }
    }),
    connect,
    destroy: Effect.fn("Docker.destroy")(function* (binding) {
      const removed = yield* runDocker(["rm", "--force", binding.containerId])
      if (removed.exitCode !== 0 && !isMissing(removed.stderr))
        return yield* new MachineProvider.Failed({ message: removed.stderr })
    }),
  })
})
