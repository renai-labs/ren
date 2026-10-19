export * as HandSession from "./hand-session.js"

import {
  type DirectoryEntry,
  type FileInfo,
  type FileNotFoundError,
  FileTooLargeError,
  maxFileBytes,
  type FileSystemError,
  orphanAfter,
  type OutputWindow,
  pingEvery,
  type ProcessEvent,
  type Range,
  type ReadResult,
  stallAfter,
  type UnauthorizedError,
  type WrongKindError,
} from "@ren/hand-api/executor-api"
import type { Signal } from "@ren/hand-api/signal"
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
  Struct,
} from "effect"
import { ChildProcessSpawner } from "effect/process"
import type { RpcClientError } from "effect/rpc"
import type { HandConnections } from "./hand-connections.js"

const disconnectedNotice = new TextEncoder().encode("\n[hand disconnected: the command did not finish]\n")

const lostNotice = (bytes: number) =>
  new TextEncoder().encode(`\n[hand reconnected: ${bytes} bytes of output were lost]\n`)

export const reconnectAfter = Duration.seconds(1)

export const stdinRetryAfter = Duration.millis(50)

const posixShells = new Set(["sh", "bash", "zsh", "dash", "ksh"])

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

const runnable = (shells: ReadonlyArray<string> = [], command: string, args: ReadonlyArray<string>) => {
  const isShellScript = args.at(0) === "-c" && posixShells.has(baseName(command))
  if (!isShellScript || shells.some((shell) => baseName(shell) === baseName(command))) return command
  return shells.at(0) ?? command
}

class OutputInterrupted extends Schema.TaggedError<OutputInterrupted>()("HandSession.OutputInterrupted", {
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
  readonly window?: OutputWindow
  readonly onSkip?: (skipped: { readonly length: number; readonly newlines: number }) => void
}

export const spawner = (
  connection: HandConnections.Connection,
  killedBySignal: KilledBySignal,
  options: SpawnOptions = {},
) =>
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
        Effect.map(Ref.get(position), (cursor) =>
          executor["process.output"]({
            id: remoteProcess.id,
            cursor,
            ...Struct.pick(options, ["window"]),
          }),
        ),
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

type Unreached = HandConnections.Unavailable | UnauthorizedError | RpcClientError.RpcClientError

export interface Files {
  readonly read: (
    path: string,
    range?: Range,
  ) => Effect.Effect<ReadResult, FileNotFoundError | WrongKindError | FileTooLargeError | FileSystemError | Unreached>
  readonly write: (
    path: string,
    bytes: Uint8Array,
  ) => Effect.Effect<void, FileTooLargeError | FileSystemError | Unreached>
  readonly stat: (path: string) => Effect.Effect<FileInfo, FileNotFoundError | FileSystemError | Unreached>
  readonly list: (
    path: string,
  ) => Effect.Effect<ReadonlyArray<DirectoryEntry>, FileNotFoundError | WrongKindError | FileSystemError | Unreached>
  readonly remove: (path: string) => Effect.Effect<void, FileSystemError | Unreached>
  readonly move: (from: string, to: string) => Effect.Effect<void, FileNotFoundError | FileSystemError | Unreached>
  readonly mkdir: (path: string) => Effect.Effect<void, FileSystemError | Unreached>
}

export interface Interface {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly spawnerWith: (options: SpawnOptions) => ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly files: Files
}

export const make = (
  connections: HandConnections.Interface,
  sessionId: Session.ID,
  killedBySignal: KilledBySignal,
): Interface => {
  const withConnection = <A, E>(use: (connection: HandConnections.Connection) => Effect.Effect<A, E>) =>
    connections.connect(sessionId).pipe(Effect.flatMap(use), Effect.scoped)
  const sessionSpawner = (options: SpawnOptions = {}) =>
    ChildProcessSpawner.make((command) =>
      connections.connect(sessionId).pipe(
        Effect.mapError(childProcessError("spawn")),
        Effect.flatMap((connection) => spawner(connection, killedBySignal, options).spawn(command)),
      ),
    )
  return {
    spawner: sessionSpawner(),
    spawnerWith: sessionSpawner,
    files: {
      read: (path, range) =>
        withConnection((connection) => connection.client["files.read"]({ path, ...(range && { range }) })),
      write: (path, bytes) =>
        bytes.length > maxFileBytes
          ? Effect.fail(new FileTooLargeError({ path, sizeBytes: bytes.length, maxBytes: maxFileBytes }))
          : withConnection((connection) => connection.client["files.write"]({ path, bytes })),
      stat: (path) => withConnection((connection) => connection.client["files.stat"]({ path })),
      list: (path) => withConnection((connection) => connection.client["files.list"]({ path })),
      remove: (path) => withConnection((connection) => connection.client["files.remove"]({ path })),
      move: (from, to) => withConnection((connection) => connection.client["files.move"]({ from, to })),
      mkdir: (path) => withConnection((connection) => connection.client["files.mkdir"]({ path })),
    },
  }
}
