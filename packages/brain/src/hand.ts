export * as Hand from "./hand.js"

import { orphanAfter, pingEvery, type ProcessEvent, stallAfter } from "@ren/brain-api/executor-api"
import type { Signal } from "@ren/brain-api/signal"
import type { Session } from "@ren/schema/session"
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
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import type { Environments } from "./environments.js"

const withoutTrailingSlash = (path: string) => path.replace(/(?<=.)\/+$/, "")

export const physicalPath = (sessionDirectory: string, directory: string) => {
  const from = withoutTrailingSlash(sessionDirectory)
  const to = withoutTrailingSlash(directory)
  const prefix = from === "/" ? from : `${from}/`
  const root = to === "/" ? to : `${to}/`
  return (path: string) => {
    if (from === to) return path
    if (withoutTrailingSlash(path) === from) return to
    if (!path.startsWith(prefix)) return path
    return `${root}${path.slice(prefix.length)}`
  }
}

const disconnectedNotice = new TextEncoder().encode("\n[environment disconnected: the command did not finish]\n")

const lostNotice = (bytes: number) =>
  new TextEncoder().encode(`\n[environment reconnected: ${bytes} bytes of output were lost]\n`)

export const reconnectAfter = Duration.seconds(1)

export const stdinRetryAfter = Duration.millis(50)

const posixShells = new Set(["sh", "bash", "zsh", "dash", "ksh"])

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

const runnable = (shells: ReadonlyArray<string> = [], command: string, args: ReadonlyArray<string>) => {
  const isShellScript = args.at(0) === "-c" && posixShells.has(baseName(command))
  if (!isShellScript || shells.some((shell) => baseName(shell) === baseName(command))) return command
  return shells.at(0) ?? command
}

class OutputInterrupted extends Schema.TaggedError<OutputInterrupted>()("Hand.OutputInterrupted", {
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

export const spawner = (connection: Environments.Connection, killedBySignal: KilledBySignal) =>
  ChildProcessSpawner.make(
    Effect.fnUntraced(function* (command) {
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
        command: runnable(connection.hello.shells, command.command, command.args),
        arguments: command.args,
        hasStdin,
        variables: Record.filter(command.options.env ?? {}, Predicate.isString),
        ...(command.options.cwd && { directory: command.options.cwd }),
        ...(Predicate.isNotUndefined(command.options.shell) && { shell: command.options.shell }),
      }).pipe(Effect.mapError(childProcessError("spawn")))
      const writeStdin = (bytes: Uint8Array, isLastWrite: boolean) =>
        executor["process.write"]({ id: remoteProcess.id, data: bytes, end: isLastWrite }).pipe(
          Effect.retry({
            while: (error) => error._tag === "StdinFullError",
            schedule: Schedule.spaced(stdinRetryAfter),
          }),
          Effect.mapError(childProcessError("stdin")),
        )
      const stdoutChunks = yield* Queue.unbounded<Uint8Array, Cause.Done>()
      const stderrChunks = yield* Queue.unbounded<Uint8Array, Cause.Done>()
      const exitResult = yield* Deferred.make<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>()
      const exited = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() =>
        Deferred.isDone(exited).pipe(
          Effect.flatMap((hasExited) =>
            hasExited
              ? Effect.void
              : executor["process.kill"]({ id: remoteProcess.id, signal: "SIGKILL" }).pipe(Effect.ignore),
          ),
        ),
      )
      yield* executor["process.heartbeat"]({ id: remoteProcess.id }).pipe(
        Effect.ignore,
        Effect.repeat(Schedule.spaced(pingEvery)),
        Effect.raceFirst(Deferred.await(exited)),
        Effect.forkScoped,
      )
      const position = yield* Ref.make(0)
      const contactAt = yield* Ref.make(yield* Clock.currentTimeMillis)
      const receive = Effect.fnUntraced(function* (event: ProcessEvent) {
        yield* Ref.set(contactAt, yield* Clock.currentTimeMillis)
        if (event.type === "ping") return
        if (event.type === "exit") {
          yield* Deferred.succeed(exited, undefined)
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
        Effect.map(Ref.get(position), (cursor) => executor["process.output"]({ id: remoteProcess.id, cursor })),
      ).pipe(
        Stream.timeoutOrElse({
          duration: stallAfter,
          orElse: () => Stream.fail(new OutputInterrupted({ message: "The output stream went silent" })),
        }),
        Stream.runForEach(receive),
        Effect.andThen(
          Deferred.isDone(exited).pipe(
            Effect.flatMap((hasExited) =>
              hasExited
                ? Effect.void
                : Effect.fail(new OutputInterrupted({ message: "The output ended before the process exited" })),
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
                  Ref.get(contactAt),
                  (now, contact) => now - contact < Duration.toMillis(orphanAfter),
                ),
        }),
        Effect.mapError(childProcessError("output")),
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const disconnected =
              !(yield* Deferred.isDone(exited)) && (Exit.isSuccess(exit) || !Cause.hasInterruptsOnly(exit.cause))
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
          Stream.runForEach((bytes) => writeStdin(bytes, false)),
          Effect.andThen(shouldEndStdin ? writeStdin(new Uint8Array(), true) : Effect.void),
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
          Effect.forEach(chunks, (bytes) => writeStdin(bytes, false), { discard: true }),
        ).pipe(Sink.mapEffect(() => (shouldEndStdin ? writeStdin(new Uint8Array(), true) : Effect.void))),
        stdout: Stream.fromQueue(stdoutChunks),
        stderr: Stream.fromQueue(stderrChunks),
        all: Stream.merge(Stream.fromQueue(stdoutChunks), Stream.fromQueue(stderrChunks)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      })
    }),
  )

export interface SessionHand {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly files: <A, E>(
    use: (connection: Environments.Connection, physical: (path: string) => string) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | Environments.Unavailable>
}

export const session = (
  environments: Environments.Interface,
  sessionId: Session.ID,
  sessionDirectory: string,
  killedBySignal: KilledBySignal,
): SessionHand => ({
  spawner: ChildProcessSpawner.make((command) =>
    environments.connect(sessionId, "processes").pipe(
      Effect.mapError(childProcessError("spawn")),
      Effect.flatMap((connection) => {
        const physical = physicalPath(sessionDirectory, connection.directory)
        return spawner(connection, killedBySignal).spawn(
          command._tag === "StandardCommand"
            ? ChildProcess.make(command.command, command.args, {
                ...command.options,
                ...(command.options.cwd && { cwd: physical(command.options.cwd) }),
              })
            : command,
        )
      }),
    ),
  ),
  files: (use) =>
    environments.connect(sessionId, "files").pipe(
      Effect.flatMap((connection) => use(connection, physicalPath(sessionDirectory, connection.directory))),
      Effect.scoped,
    ),
})
