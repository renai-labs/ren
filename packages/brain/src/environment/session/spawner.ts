export * as EnvironmentSpawner from "./spawner.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import type { Signal } from "@ren/environment-api/signal"
import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  PlatformError,
  Predicate,
  Queue,
  Record,
  Ref,
  Schedule,
  Schema,
  Sink,
  Stream,
  Struct,
} from "effect"
import { ChildProcessSpawner } from "effect/process"
import type { EnvironmentConnections } from "../connections.js"

const disconnectedNotice = new TextEncoder().encode("\n[environment disconnected: the command did not finish]\n")

const lostNotice = (bytes: number) =>
  new TextEncoder().encode(`\n[environment reconnected: ${bytes} bytes of output were lost]\n`)

const reconnectAfter = Duration.seconds(1)

const stdinRetryAfter = Duration.millis(50)

const posixShells = new Set(["sh", "bash", "zsh", "dash", "ksh"])

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

const commandToRun = (command: string, args: ReadonlyArray<string>, shells: ReadonlyArray<string> = []) => {
  const isShellScript = args.at(0) === "-c" && posixShells.has(baseName(command))
  if (!isShellScript || shells.some((shell) => baseName(shell) === baseName(command))) return command
  return shells.at(0) ?? command
}

class OutputDropped extends Schema.TaggedError<OutputDropped>()("EnvironmentSpawner.OutputDropped", {
  message: Schema.String,
}) {}

export const childProcessError = (method: string) => (cause: unknown) =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "ChildProcess",
    method,
    description: cause instanceof Error ? cause.message : String(cause),
    cause,
  })

export type KilledBySignal = (signal: Signal.Name) => unknown

export interface SpawnOptions {
  readonly outputFile?: string
  readonly window?: EnvironmentApi.OutputWindow
  readonly onSkip?: (skipped: { readonly length: number; readonly newlines: number }) => void
}

export const make = (
  connection: EnvironmentConnections.Connection,
  killedBySignal: KilledBySignal,
  options: SpawnOptions = {},
) =>
  ChildProcessSpawner.make(
    Effect.fn("EnvironmentSpawner.spawn")(function* (command) {
      if (command._tag === "PipedCommand")
        return yield* PlatformError.badArgument({
          module: "ChildProcess",
          method: "spawn",
          description: "A ren environment does not run piped commands",
        })
      const executor = connection.client
      const stdin = command.options.stdin
      const stdinConfig =
        typeof stdin === "object" && !Stream.isStream(stdin) ? stdin : { stream: stdin, endOnDone: true }
      const stdinStream = Stream.isStream(stdinConfig.stream) ? stdinConfig.stream : undefined
      const hasStdin = Boolean(stdinStream) || !stdinConfig.stream || stdinConfig.stream === "pipe"
      const shouldEndStdin = stdinConfig.endOnDone !== false
      const remoteProcess = yield* executor["process.spawn"]({
        command: commandToRun(command.command, command.args, connection.hello.shells),
        arguments: command.args,
        hasStdin,
        variables: Record.filter(command.options.env ?? {}, Predicate.isString),
        ...(command.options.cwd && { directory: command.options.cwd }),
        ...(Predicate.isNotUndefined(command.options.shell) && { shell: command.options.shell }),
        ...Struct.pick(options, ["outputFile"]),
      }).pipe(Effect.mapError(childProcessError("spawn")))
      const writeStdin = (bytes: Uint8Array, options: { readonly end: boolean }) =>
        executor["process.write"]({ id: remoteProcess.id, data: bytes, end: options.end }).pipe(
          Effect.retry({
            while: (error) => error._tag === "StdinFullError",
            schedule: Schedule.spaced(stdinRetryAfter),
          }),
          Effect.mapError(childProcessError("stdin")),
        )
      const stdoutChunks = yield* Queue.unbounded<Uint8Array, Cause.Done>()
      const stderrChunks = yield* Queue.unbounded<Uint8Array, Cause.Done>()
      const exitResult = yield* Deferred.make<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>()
      const exitReported = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() =>
        Deferred.isDone(exitReported).pipe(
          Effect.flatMap((hasExited) =>
            hasExited
              ? Effect.void
              : executor["process.kill"]({ id: remoteProcess.id, signal: "SIGKILL" }).pipe(Effect.ignore),
          ),
        ),
      )
      yield* executor["process.heartbeat"]({ id: remoteProcess.id }).pipe(
        Effect.ignore,
        Effect.repeat(Schedule.spaced(EnvironmentApi.pingEvery)),
        Effect.raceFirst(Deferred.await(exitReported)),
        Effect.forkScoped,
      )
      const position = yield* Ref.make(0)
      const lastContactAtMs = yield* Ref.make(yield* Clock.currentTimeMillis)
      const receive = Effect.fnUntraced(function* (event: EnvironmentApi.ProcessEvent) {
        yield* Ref.set(lastContactAtMs, yield* Clock.currentTimeMillis)
        if (event.type === "ping") return
        if (event.type === "skip") {
          const reached = yield* Ref.get(position)
          if (event.offset > reached) yield* Queue.offer(stderrChunks, lostNotice(event.offset - reached))
          const end = event.offset + event.length
          if (end <= reached) return
          yield* Ref.set(position, end)
          options.onSkip?.({ length: end - Math.max(reached, event.offset), newlines: event.newlines })
          return
        }
        if (event.type === "exit") {
          yield* Deferred.succeed(exitReported, undefined)
          yield* event.signal
            ? Deferred.fail(exitResult, childProcessError("exitCode")(killedBySignal(event.signal)))
            : Deferred.succeed(exitResult, ChildProcessSpawner.ExitCode(event.exitCode))
          return
        }
        const reached = yield* Ref.get(position)
        if (event.offset > reached) yield* Queue.offer(stderrChunks, lostNotice(event.offset - reached))
        const bytes = event.offset < reached ? event.bytes.subarray(reached - event.offset) : event.bytes
        yield* Ref.set(position, Math.max(reached, event.offset + event.bytes.length))
        if (bytes.length === 0) return
        yield* Queue.offer(event.type === "stdout" ? stdoutChunks : stderrChunks, bytes)
      })
      yield* Stream.unwrap(
        Effect.map(Ref.get(position), (cursor) =>
          executor["process.output"]({
            id: remoteProcess.id,
            cursor,
            ...Struct.pick(options, ["window"]),
          }),
        ),
      ).pipe(
        Stream.timeoutOrElse({
          duration: EnvironmentApi.stallAfter,
          orElse: () => Stream.fail(new OutputDropped({ message: "The output stream went silent" })),
        }),
        Stream.runForEach(receive),
        Effect.andThen(
          Deferred.isDone(exitReported).pipe(
            Effect.flatMap((hasExited) =>
              hasExited
                ? Effect.void
                : Effect.fail(new OutputDropped({ message: "The output ended before the process exited" })),
            ),
          ),
        ),
        Effect.retry({
          schedule: Schedule.spaced(reconnectAfter),
          while: (error) =>
            error._tag === "ProcessNotFoundError"
              ? Effect.succeed(false)
              : Effect.zipWith(
                  Clock.currentTimeMillis,
                  Ref.get(lastContactAtMs),
                  (now, contact) => now - contact < Duration.toMillis(EnvironmentApi.orphanAfter),
                ),
        }),
        Effect.mapError(childProcessError("output")),
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const disconnected =
              !(yield* Deferred.isDone(exitReported)) && (Exit.isSuccess(exit) || !Cause.hasInterruptsOnly(exit.cause))
            if (disconnected) yield* Queue.offer(stderrChunks, disconnectedNotice)
            yield* Queue.end(stdoutChunks)
            yield* Queue.end(stderrChunks)
            yield* Deferred.failCause(
              exitResult,
              exit._tag === "Failure" && Cause.hasFails(exit.cause)
                ? exit.cause
                : Cause.fail(childProcessError("output")(new Error("The output ended before the process exited"))),
            )
          }),
        ),
        Effect.forkScoped,
      )
      if (stdinStream)
        yield* stdinStream.pipe(
          Stream.runForEach((bytes) => writeStdin(bytes, { end: false })),
          Effect.andThen(shouldEndStdin ? writeStdin(new Uint8Array(), { end: true }) : Effect.void),
          Effect.ignore,
          Effect.forkScoped,
        )
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(remoteProcess.pid),
        exitCode: Deferred.await(exitResult),
        isRunning: Deferred.isDone(exitResult).pipe(Effect.map((hasExited) => !hasExited)),
        kill: (options) =>
          executor["process.kill"]({
            id: remoteProcess.id,
            signal: options?.killSignal ?? "SIGTERM",
            ...(options?.forceKillAfter && {
              forceKillAfterMs: Duration.toMillis(Duration.fromInputUnsafe(options.forceKillAfter)),
            }),
          }).pipe(
            Effect.catchTag("ProcessNotFoundError", () => Effect.void),
            Effect.mapError(childProcessError("kill")),
            Effect.andThen(Deferred.await(exitResult).pipe(Effect.ignore)),
          ),
        stdin: Sink.forEachArray((chunks: ReadonlyArray<Uint8Array>) =>
          Effect.forEach(chunks, (bytes) => writeStdin(bytes, { end: false }), { discard: true }),
        ).pipe(Sink.mapEffect(() => (shouldEndStdin ? writeStdin(new Uint8Array(), { end: true }) : Effect.void))),
        stdout: Stream.fromQueue(stdoutChunks),
        stderr: Stream.fromQueue(stderrChunks),
        all: Stream.merge(Stream.fromQueue(stdoutChunks), Stream.fromQueue(stderrChunks)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      })
    }),
  )
