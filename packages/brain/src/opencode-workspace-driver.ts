export * as OpenCodeWorkspaceDriver from "./opencode-workspace-driver.js"

import { EnvironmentFiles } from "@opencode/core/environment/files"
import { RipgrepBinary } from "@opencode/core/ripgrep/binary"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { Workspace } from "@opencode/schema/workspace"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { FileNotFoundError, WrongKindError } from "@ren/brain-api/executor-api"
import { Environment } from "@ren/schema/environment"
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Layer,
  PlatformError,
  Predicate,
  Queue,
  Record,
  Schema,
  Sink,
  Stream,
} from "effect"
import { ChildProcessSpawner } from "effect/process"
import { Environments } from "./environments.js"

export const provider = "ren"

export const workspaceId = (environmentId: Environment.ID) =>
  Workspace.ID.make(`wrk_${environmentId.slice(environmentId.indexOf("_") + 1)}`)

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
      yield* Effect.addFinalizer(() =>
        Deferred.isDone(exitResult).pipe(
          Effect.flatMap((hasExited) =>
            hasExited
              ? Effect.void
              : executor["process.kill"]({ id: remoteProcess.id, signal: "SIGKILL" }).pipe(Effect.ignore),
          ),
        ),
      )
      yield* executor["process.output"]({ id: remoteProcess.id }).pipe(
        Stream.runForEach((event) => {
          if (event.type === "stdout") return Queue.offer(stdoutChunks, event.bytes)
          if (event.type === "stderr") return Queue.offer(stderrChunks, event.bytes)
          if (event.type === "ping") return Effect.void
          return event.signal
            ? Deferred.fail(
                exitResult,
                childProcessError("exitCode")(new CrossSpawnSpawner.KilledBySignal(event.signal)),
              )
            : Deferred.succeed(exitResult, ChildProcessSpawner.ExitCode(event.exitCode ?? 1))
        }),
        Effect.mapError(childProcessError("output")),
        Effect.onExit((exit) =>
          Effect.all([
            Queue.end(stdoutChunks),
            Queue.end(stderrChunks),
            Deferred.failCause(
              exitResult,
              exit._tag === "Failure" && Cause.hasFails(exit.cause)
                ? exit.cause
                : Cause.fail(childProcessError("output")(new Error("The output ended before the process exited"))),
            ),
          ]),
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
        ),
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
