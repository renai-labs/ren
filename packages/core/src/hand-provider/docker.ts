export * as Docker from "./docker.js"

import { ExecutorClient } from "@ren/hand-api/executor-client"
import { Signature } from "@ren/hand-api/signature"
import { Hand } from "@ren/schema/hand"
import { Duration, Effect, Schedule, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { HandProvider } from "../hand-provider.js"

const Config = Schema.Struct({
  image: Schema.NonEmptyString.annotate({
    title: "Image",
    description: "A Docker image that runs Ren’s executor on port 4100.",
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

const executorPort = "4100/tcp"

const readyWithin = Duration.seconds(30)

const isMissing = (stderr: string) => /no such (container|object)/iu.test(stderr)

const isNameTaken = (stderr: string) => /is already in use/u.test(stderr)

export const provider = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const http = yield* HttpClient.HttpClient

  const docker = (args: ReadonlyArray<string>) =>
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
      Effect.mapError((error) => new HandProvider.Failed({ message: `docker ${args.at(0) ?? ""}: ${error.message}` })),
    )

  const containerOf = (name: string) =>
    docker(["container", "inspect", "--format", "{{.Id}}", name]).pipe(
      Effect.map((inspected) => (inspected.exitCode === 0 ? inspected.stdout : undefined)),
    )

  const ready = (url: string) =>
    http.execute(HttpClientRequest.post(`${url}${ExecutorClient.path}`)).pipe(
      Effect.asVoid,
      Effect.timeout(Duration.seconds(1)),
      Effect.retry({ schedule: Schedule.spaced(Duration.millis(200)) }),
      Effect.timeout(readyWithin),
      Effect.mapError(
        () =>
          new HandProvider.Failed({
            message: `The executor at ${url} did not answer within ${Duration.format(readyWithin)}`,
          }),
      ),
    )

  return HandProvider.make({
    id: Hand.ProviderID.make("docker"),
    title: "Docker",
    description: "A container on the machine that runs Ren, made from an image that runs Ren’s executor.",
    config: Config,
    binding: Binding,
    provision: Effect.fn("Docker.provision")(function* (input) {
      const name = `ren-${input.handId}`
      const existing = yield* containerOf(name)
      if (existing) return { containerId: existing }
      const started = yield* docker([
        "run",
        "--detach",
        "--init",
        "--name",
        name,
        "--label",
        `ren.hand=${input.handId}`,
        "--publish",
        `127.0.0.1::${executorPort}`,
        "--env",
        `EXECUTOR_ENVIRONMENT_ID=${input.environmentId}`,
        "--env",
        `BRAIN_PUBLIC_KEYS=${Schema.encodeSync(Signature.PublicKeys)(input.publicKeys)}`,
        ...(input.config.cpus ? ["--cpus", String(input.config.cpus)] : []),
        ...(input.config.memoryMiB ? ["--memory", `${input.config.memoryMiB}m`] : []),
        input.config.image,
      ])
      if (started.exitCode === 0) return { containerId: started.stdout }
      if (!isNameTaken(started.stderr))
        return yield* new HandProvider.Failed({ message: `docker run ${input.config.image}: ${started.stderr}` })
      // oxlint-disable-next-line ren/no-comments -- Another call for this hand holds the name; Docker shows its container only after it is made.
      return yield* containerOf(name).pipe(
        Effect.flatMap((raced) =>
          raced
            ? Effect.succeed({ containerId: raced })
            : Effect.fail(new HandProvider.Failed({ message: `Another call is still making the container ${name}` })),
        ),
        Effect.retry({ schedule: Schedule.spaced(Duration.millis(100)), times: 100 }),
      )
    }),
    connect: Effect.fn("Docker.connect")(function* (binding) {
      const running = yield* docker(["container", "inspect", "--format", "{{.State.Running}}", binding.containerId])
      if (running.exitCode !== 0 && isMissing(running.stderr))
        return yield* new HandProvider.Gone({ message: `The container ${binding.containerId} no longer exists` })
      if (running.exitCode !== 0) return yield* new HandProvider.Failed({ message: running.stderr })
      if (running.stdout !== "true") {
        const restarted = yield* docker(["start", binding.containerId])
        if (restarted.exitCode !== 0) return yield* new HandProvider.Failed({ message: restarted.stderr })
      }
      const published = yield* docker(["port", binding.containerId, executorPort])
      const port = /:(\d+)$/mu.exec(published.stdout)?.at(1)
      if (published.exitCode !== 0 || !port)
        return yield* new HandProvider.Failed({
          message: `The container ${binding.containerId} publishes no executor port: ${published.stderr}`,
        })
      const url = `http://127.0.0.1:${port}`
      yield* ready(url)
      return { url }
    }),
    destroy: Effect.fn("Docker.destroy")(function* (binding) {
      const removed = yield* docker(["rm", "--force", binding.containerId])
      if (removed.exitCode !== 0 && !isMissing(removed.stderr))
        return yield* new HandProvider.Failed({ message: removed.stderr })
    }),
  })
})
