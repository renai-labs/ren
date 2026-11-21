export * as SandboxSetup from "./setup.js"

import { HandApi } from "@ren/hand-api/hand-api"
import type { Packages } from "@ren/schema/packages"
import { Duration, Effect, Fiber, Option, Semaphore, Stream } from "effect"
import { ChildProcess, type ChildProcessSpawner } from "effect/process"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const keptChars = 2000

const drainWithin = Duration.seconds(1)

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

export const make = (options: {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly workspace: string
  readonly directory: string
  readonly variables: () => Readonly<Record<string, string>>
}) => {
  const running = Semaphore.makeUnsafe(1)
  const isRoot = process.getuid?.() === 0

  const runStep = (entry: HandApi.SetupEntry, step: Packages.Step) =>
    Effect.gen(function* () {
      const failed = (reason: string) =>
        new HandApi.SetupFailedError({ message: `Setup of ${entry.name} failed: ${step.command} ${reason}` })
      const argv =
        step.user === "root" && !isRoot
          ? { command: "sudo", arguments: ["-n", "sh", "-c", step.command] }
          : { command: "sh", arguments: ["-c", step.command] }
      const handle = yield* options.spawner
        .spawn(
          ChildProcess.make(argv.command, argv.arguments, {
            cwd: options.workspace,
            env: options.variables(),
            extendEnv: false,
            stdin: "ignore",
            killSignal: "SIGKILL",
          }),
        )
        .pipe(
          Effect.mapError((error) => failed(`did not start: ${error.message}`)),
          Effect.catchDefect((defect) => Effect.fail(failed(`did not start: ${message(defect)}`))),
        )
      const output = yield* handle.all.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (kept, text) => (kept + text).slice(-keptChars),
        ),
        Effect.orElseSucceed(() => ""),
        Effect.withErrorReporting,
        Effect.forkScoped,
      )
      const exitCode = yield* handle.exitCode.pipe(Effect.mapError((error) => failed(`failed: ${error.message}`)))
      if (exitCode === 0) return
      const tail = yield* Fiber.join(output).pipe(Effect.timeoutOption(drainWithin))
      return yield* failed(`exited with ${exitCode}: ${Option.getOrElse(tail, () => "").trim()}`)
    }).pipe(Effect.scoped)

  const runEntry = Effect.fnUntraced(function* (entry: HandApi.SetupEntry) {
    const mark = join(options.directory, entry.key)
    if (yield* Effect.promise(() => Bun.file(mark).exists())) return
    yield* Effect.forEach(entry.steps, (each) => runStep(entry, each), { discard: true })
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(options.directory, { recursive: true })
        await Bun.write(mark, "")
      },
      catch: (cause) =>
        new HandApi.SetupFailedError({
          message: `Setup of ${entry.name} ran, but its mark was not written: ${message(cause)}`,
        }),
    })
  })

  const run = Effect.fn("Executor.setup")(function* (entries: ReadonlyArray<HandApi.SetupEntry>) {
    const failures = yield* Effect.forEach(entries, (entry) =>
      runEntry(entry).pipe(
        Effect.as(Option.none<string>()),
        Effect.catch((error) => Effect.logWarning(error.message).pipe(Effect.as(Option.some(error.message)))),
      ),
    )
    const messages = failures.filter(Option.isSome).map((failure) => failure.value)
    if (messages.length > 0) return yield* new HandApi.SetupFailedError({ message: messages.join("\n") })
  })

  return (entries: ReadonlyArray<HandApi.SetupEntry>) => running.withPermits(1)(Effect.uninterruptible(run(entries)))
}
