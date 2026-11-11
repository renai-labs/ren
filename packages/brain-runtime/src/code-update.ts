export * as CodeUpdate from "./code-update.js"

import { BrainRejectedError } from "@ren/host-api/errors"
import type { Bundle } from "@ren/schema/bundle"
import { Context, Effect, FileSystem, Layer, Path, Semaphore, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

// oxlint-disable-next-line ren/no-comments -- A bundle, and the token with which the machine downloads it from Ren.
export interface Download extends Bundle.Info {
  readonly token: string
}

// oxlint-disable-next-line ren/no-comments -- A command of the machine's template, as root or as the machine's user (EN22).
export interface Step {
  readonly command: string
  readonly user: "root" | "user"
}

// oxlint-disable-next-line ren/no-comments -- How a machine takes newer bundles of Ren's code and its template's new steps at a wake (EN22, EN27). Only a machine that runs start.sh can; any other host is replaced instead.
export interface Interface {
  readonly update: (
    bundles: ReadonlyArray<Download>,
    steps: ReadonlyArray<Step>,
  ) => Effect.Effect<void, BrainRejectedError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain-runtime/CodeUpdate") {}

export const layerProcess = (options: {
  readonly home: string
  readonly script: string
  readonly version: string
  readonly restart: Effect.Effect<void>
}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const updates = yield* Semaphore.make(1)
      return Service.of({
        update: Effect.fn("CodeUpdate.update")(function* (bundles, steps) {
          const run = Effect.fnUntraced(function* (command: string, args: ReadonlyArray<string>, failed: string) {
            const ran = yield* Effect.gen(function* () {
              const child = yield* spawner.spawn(
                ChildProcess.make(command, args, {
                  env: { HOME: options.home },
                  extendEnv: true,
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "pipe",
                }),
              )
              return yield* Effect.all(
                {
                  code: child.exitCode,
                  error: child.stderr.pipe(
                    Stream.decodeText(),
                    Stream.runFold(
                      () => "",
                      (tail, text) => (tail + text).slice(-500),
                    ),
                  ),
                },
                { concurrency: "unbounded" },
              )
            }).pipe(
              Effect.scoped,
              Effect.mapError((error) => new BrainRejectedError({ message: `${failed}: ${error.message}` })),
            )
            if (ran.code !== 0) return yield* new BrainRejectedError({ message: `${failed}: ${ran.error}` })
          })
          yield* Effect.forEach(
            steps,
            (step) =>
              run(
                step.user === "root" ? "sudo" : "sh",
                step.user === "root" ? ["-n", "sh", "-c", step.command] : ["-c", step.command],
                `The step ${step.command} failed`,
              ),
            { discard: true },
          )
          yield* run(
            "sh",
            [
              options.script,
              "prepare",
              bundles.map((bundle) => [bundle.kind, bundle.version, bundle.sha256, bundle.token].join(":")).join(" "),
            ],
            "The bundles did not unpack",
          )
          const current = yield* fs
            .readFileString(path.join(options.home, ".ren", "brain.version"))
            .pipe(
              Effect.mapError(
                (error) => new BrainRejectedError({ message: `The brain version could not be read: ${error.message}` }),
              ),
            )
          if (current.trim() !== options.version) yield* options.restart
        }, updates.withPermits(1)),
      })
    }),
  )

export const layerNone = Layer.succeed(
  Service,
  Service.of({
    update: () => Effect.fail(new BrainRejectedError({ message: "This host takes no bundles; Ren replaces it" })),
  }),
)
