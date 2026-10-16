export * as OpenCodeWorkspaceDriver from "./opencode-workspace-driver.js"

import { EnvironmentFiles } from "@opencode/core/environment/files"
import { RipgrepBinary } from "@opencode/core/ripgrep/binary"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { Workspace } from "@opencode/schema/workspace"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import {
  FileNotFoundError,
  orphanAfter,
  type ProcessEvent,
  stallAfter,
  WrongKindError,
} from "@ren/brain-api/executor-api"
import { Environment } from "@ren/schema/environment"
import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
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
import { ChildProcessSpawner } from "effect/process"
import { Environments } from "./environments.js"

export const provider = "ren"

export const workspaceId = (environmentId: Environment.ID) =>
  Workspace.ID.make(`wrk_${environmentId.slice(environmentId.indexOf("_") + 1)}`)

const disconnectedNotice = new TextEncoder().encode("\n[environment disconnected: the command did not finish]\n")

const lostNotice = (bytes: number) =>
  new TextEncoder().encode(`\n[environment reconnected: ${bytes} bytes of output were lost]\n`)

export const reconnectAfter = Duration.seconds(1)

class OutputInterrupted extends Schema.TaggedError<OutputInterrupted>()("OpenCodeWorkspaceDriver.OutputInterrupted", {
  message: Schema.String,
}) {}

const childProcessError = (method: string) => (cause: unknown) =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "ChildProcess",
    method,
    description: cause instanceof Error ? cause.message : String(cause),
    cause,
  })

export const spawner = (connection: Environments.Connection) =>
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
        command: command.command,
        arguments: command.args,
        hasStdin,
        variables: Record.filter(command.options.env ?? {}, Predicate.isString),
        ...(command.options.cwd && { directory: command.options.cwd }),
        ...(Predicate.isNotUndefined(command.options.shell) && { shell: command.options.shell }),
      }).pipe(Effect.mapError(childProcessError("spawn")))
      const writeStdin = (bytes: Uint8Array, isLastWrite: boolean) =>
        executor["process.write"]({ id: remoteProcess.id, data: bytes, end: isLastWrite }).pipe(
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
      const position = yield* Ref.make(0)
      const contactAt = yield* Ref.make(yield* Clock.currentTimeMillis)
      const receive = Effect.fnUntraced(function* (event: ProcessEvent) {
        yield* Ref.set(contactAt, yield* Clock.currentTimeMillis)
        if (event.type === "ping") return
        if (event.type === "exit") {
          yield* Deferred.succeed(exited, undefined)
          yield* event.signal
            ? Deferred.fail(
                exitResult,
                childProcessError("exitCode")(new CrossSpawnSpawner.KilledBySignal(event.signal)),
              )
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

export const files = (connection: Environments.Connection): EnvironmentFiles.FilesImpl => {
  const client = connection.client
  const fileError = (path: string) => (cause: unknown) => new EnvironmentFiles.Failed({ path, cause })
  const fileLookupError = (path: string) => (error: unknown) =>
    error instanceof FileNotFoundError ? new EnvironmentFiles.NotFound({ path }) : fileError(path)(error)
  const fileKindError = (path: string) => (error: unknown) =>
    error instanceof WrongKindError
      ? new EnvironmentFiles.WrongKind({ path, actual: error.actual })
      : fileLookupError(path)(error)
  return {
    read: (path, range) =>
      client["files.read"]({ path, ...(range && { range }) }).pipe(
        Effect.map((result) => ({
          bytes: result.bytes,
          info: { type: result.info.type, size: result.info.sizeBytes, mtimeMs: result.info.modifiedAtMs },
        })),
        Effect.mapError(fileKindError(path)),
      ),
    write: (path, bytes) => client["files.write"]({ path, bytes }).pipe(Effect.mapError(fileError(path))),
    stat: (path) =>
      client["files.stat"]({ path }).pipe(
        Effect.map((info) => ({ type: info.type, size: info.sizeBytes, mtimeMs: info.modifiedAtMs })),
        Effect.mapError(fileLookupError(path)),
      ),
    list: (path) => client["files.list"]({ path }).pipe(Effect.mapError(fileKindError(path))),
    remove: (path) => client["files.remove"]({ path }).pipe(Effect.mapError(fileError(path))),
    move: (from, to) => client["files.move"]({ from, to }).pipe(Effect.mapError(fileLookupError(from))),
    mkdir: (path) => client["files.mkdir"]({ path }).pipe(Effect.mapError(fileError(path))),
  }
}

export const replacements = (environments: Environments.Interface): LayerNode.Replacements => [
  WorkspaceDriver.node.replace(
    WorkspaceDriver.registryNode({
      [provider]: WorkspaceDriver.make({
        create: () => Effect.succeed({ binding: {} }),
        connect: (input) =>
          Schema.decodeUnknownEffect(Environment.ID)(
            `env_${input.workspaceID.slice(input.workspaceID.indexOf("_") + 1)}`,
          ).pipe(
            Effect.flatMap(environments.connect),
            Effect.map((connection) => ({ spawner: spawner(connection), overrides: files(connection) })),
            Effect.mapError((cause) => new WorkspaceDriver.Error({ message: cause.message, cause })),
          ),
        suspendForIdle: () => Effect.void,
        destroy: () => Effect.void,
      }),
    }),
  ),
  RipgrepBinary.node.replace(
    Layer.succeed(RipgrepBinary.Service, RipgrepBinary.Service.of({ filepath: Effect.succeed("rg") })),
  ),
]
