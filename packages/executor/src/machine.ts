export * as Machine from "./machine.js"

import {
  exitedKeptFor,
  type FileInfo,
  FileNotFoundError,
  FileTooLargeError,
  type FileType,
  maxFileBytes,
  OperationFailedError,
  orphanAfter,
  type OutputWindow,
  pingEvery,
  ProcessID,
  ProcessNotFoundError,
  protocol,
  type Range,
  type SpawnInput,
  StdinFullError,
  WrongKindError,
} from "@ren/hand-api/executor-api"
import { Signal } from "@ren/hand-api/signal"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import {
  Cause,
  Clock,
  Config,
  Duration,
  Effect,
  Exit,
  Layer,
  type PlatformError,
  Option,
  Queue,
  Schedule,
  Schema,
  Scope,
  Stream,
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { constants } from "node:fs"
import { access, lstat, mkdir, open, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import manifest from "../package.json"
import { Executor } from "./executor.js"
import { OutputLog } from "./machine/output-log.js"

export const exitedLimitBytes = 64 * 1024 * 1024

interface Entry {
  readonly id: ProcessID
  readonly brain: Brain.ID
  readonly scope: Scope.Closeable
  readonly handle: ChildProcessSpawner.ChildProcessHandle
  readonly stdin: Queue.Queue<Uint8Array, Cause.Done> | undefined
  readonly log: OutputLog.Log
  seenAtMs: number
  isHeartbeating: boolean
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const isMissing = (cause: unknown) =>
  cause instanceof Error && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR")

const fileType = (entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileType => {
  if (entry.isFile()) return "file"
  if (entry.isDirectory()) return "directory"
  if (entry.isSymbolicLink()) return "symlink"
  return "other"
}

const attempt = <A>(path: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new OperationFailedError({ path, message: message(cause) }) })

const attemptFound = <A>(path: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      isMissing(cause) ? new FileNotFoundError({ path }) : new OperationFailedError({ path, message: message(cause) }),
  })

const killedBy = (error: PlatformError.PlatformError) =>
  Schema.decodeUnknownOption(Signal.Name)(
    /^Process interrupted due to receipt of signal: '(\w+)'$/.exec(message(error.reason.cause))?.at(1),
  )

export const layer = Layer.effect(
  Executor.Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const config = yield* Config.all({
      environmentId: Config.schema(Environment.ID, "EXECUTOR_ENVIRONMENT_ID"),
      workspaceDirectory: Config.String("EXECUTOR_WORKSPACE").pipe(Config.withDefault(process.cwd())),
    })
    const workspace = yield* Effect.promise(() => realpath(resolve(config.workspaceDirectory)))
    const shells = yield* Effect.filter(
      [
        ...new Set(
          [process.env.SHELL, "/bin/bash", "/usr/bin/bash", "/bin/zsh", "/usr/bin/zsh", "/bin/dash", "/bin/sh"].filter(
            (candidate): candidate is string => Boolean(candidate),
          ),
        ),
      ],
      (candidate) =>
        Effect.promise(() =>
          access(candidate, constants.X_OK).then(
            () => true,
            () => false,
          ),
        ),
    )
    const path = (value: string) => resolve(workspace, value)
    const describe = (value: string, followLink: boolean) =>
      attemptFound(value, () => (followLink ? stat(path(value)) : lstat(path(value)))).pipe(
        Effect.map((stats): FileInfo => ({
          type: fileType(stats),
          sizeBytes: stats.size,
          modifiedAtMs: stats.mtimeMs,
        })),
      )
    const processes = new Map<ProcessID, Entry>()
    const exitOrder: Array<ProcessID> = []
    const scope = yield* Effect.scope

    const find = Effect.fnUntraced(function* (brain: Brain.ID, id: ProcessID) {
      const entry = processes.get(id)
      if (!entry || entry.brain !== brain) return yield* new ProcessNotFoundError({ id })
      entry.seenAtMs = yield* Clock.currentTimeMillis
      return entry
    })

    const release = (entry: Entry) =>
      Effect.sync(() => {
        processes.delete(entry.id)
        if (exitOrder.includes(entry.id)) exitOrder.splice(exitOrder.indexOf(entry.id), 1)
      }).pipe(Effect.andThen(Scope.close(entry.scope, Exit.void)))

    const recordExit = Effect.fnUntraced(function* (entry: Entry, event: OutputLog.ExitEvent) {
      yield* OutputLog.end(entry.log, event)
      entry.seenAtMs = yield* Clock.currentTimeMillis
      exitOrder.push(entry.id)
      const exited = exitOrder.flatMap((id) => {
        const found = processes.get(id)
        return found ? [found] : []
      })
      const total = exited.reduce((bytes, found) => bytes + OutputLog.keptBytes(found.log), 0)
      const oldest = exited.reduce<{ readonly bytes: number; readonly entries: ReadonlyArray<Entry> }>(
        (dropped, found) =>
          total - dropped.bytes > exitedLimitBytes
            ? { bytes: dropped.bytes + OutputLog.keptBytes(found.log), entries: [...dropped.entries, found] }
            : dropped,
        { bytes: 0, entries: [] },
      )
      yield* Effect.forEach(oldest.entries, release, { discard: true })
    })

    yield* Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const orphans = [...processes.values()].filter((entry) =>
        entry.log.exit
          ? !OutputLog.hasReaders(entry.log) && now - entry.seenAtMs >= Duration.toMillis(exitedKeptFor)
          : (!OutputLog.hasReaders(entry.log) || entry.isHeartbeating) &&
            now - entry.seenAtMs >= Duration.toMillis(orphanAfter),
      )
      yield* Effect.forEach(orphans, release, { discard: true })
    }).pipe(Effect.repeat(Schedule.spaced(Duration.seconds(1))), Effect.forkIn(scope))

    const spawn = Effect.fn("Executor.spawn")(function* (brain: Brain.ID, input: SpawnInput) {
      const entryScope = yield* Scope.fork(scope)
      const outputFile = input.outputFile
      const output = outputFile
        ? yield* Effect.acquireRelease(
            Effect.tryPromise(async () => {
              await mkdir(dirname(path(outputFile)), { recursive: true })
              return open(path(outputFile), "w")
            }),
            (file) => Effect.promise(() => file.close()),
          ).pipe(
            Scope.provide(entryScope),
            Effect.mapError((cause) => new OperationFailedError({ message: message(cause) })),
            Effect.onError(() => Scope.close(entryScope, Exit.void)),
          )
        : undefined
      const stdin = input.hasStdin === true ? yield* Queue.bounded<Uint8Array, Cause.Done>(16) : undefined
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(input.command, input.arguments, {
            cwd: path(input.directory ?? workspace),
            env: input.variables,
            extendEnv: true,
            shell: input.shell,
            stdin: stdin ? { stream: Stream.fromQueue(stdin), endOnDone: true } : "ignore",
            killSignal: "SIGKILL",
          }),
        )
        .pipe(
          Scope.provide(entryScope),
          Effect.mapError((cause) => new OperationFailedError({ message: message(cause) })),
          Effect.catchDefect((defect) => Effect.fail(new OperationFailedError({ message: message(defect) }))),
          Effect.onError(() => Scope.close(entryScope, Exit.void)),
        )
      const id = ProcessID.create()
      const entry: Entry = {
        id,
        brain,
        scope: entryScope,
        handle,
        stdin,
        log: yield* OutputLog.make.pipe(Scope.provide(entryScope)),
        seenAtMs: yield* Clock.currentTimeMillis,
        isHeartbeating: false,
      }
      processes.set(id, entry)
      const tagged = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>, type: "stdout" | "stderr") =>
        stream.pipe(
          Stream.map((bytes) => ({ type, bytes })),
          Stream.ignore,
        )
      yield* Stream.merge(tagged(handle.stdout, "stdout"), tagged(handle.stderr, "stderr")).pipe(
        Stream.runForEach((written) =>
          Effect.gen(function* () {
            if (output) yield* Effect.promise(() => output.write(written.bytes).catch(() => undefined))
            yield* OutputLog.append(entry.log, written.type, written.bytes)
          }),
        ),
        Effect.andThen(
          handle.exitCode.pipe(
            Effect.map((exitCode): OutputLog.ExitEvent => ({ type: "exit", exitCode, signal: null })),
            Effect.catch((error) =>
              Option.match(killedBy(error), {
                onSome: (signal) => Effect.succeed<OutputLog.ExitEvent>({ type: "exit", exitCode: null, signal }),
                onNone: () => Effect.die(error),
              }),
            ),
          ),
        ),
        Effect.flatMap((event) => recordExit(entry, event)),
        Effect.andThen(stdin ? Queue.shutdown(stdin) : Effect.void),
        Effect.onError((cause) => OutputLog.fail(entry.log, cause)),
        Effect.forkIn(entryScope),
      )
      return { id, pid: handle.pid }
    })

    const output = Effect.fn("Executor.output")(function* (
      brain: Brain.ID,
      id: ProcessID,
      cursor?: number,
      window?: OutputWindow,
    ) {
      const entry = yield* find(brain, id)
      const seen = Effect.map(Clock.currentTimeMillis, (now) => {
        entry.seenAtMs = now
      })
      return OutputLog.read(entry.log, cursor, window).pipe(
        Stream.merge(Stream.tick(pingEvery).pipe(Stream.drop(1), Stream.as({ type: "ping" as const })), {
          haltStrategy: "left",
        }),
        Stream.ensuring(seen),
      )
    })

    const writeStdin = Effect.fn("Executor.writeStdin")(function* (
      brain: Brain.ID,
      id: ProcessID,
      data: Uint8Array,
      end: boolean,
    ) {
      const stdin = (yield* find(brain, id)).stdin
      if (!stdin) return yield* new OperationFailedError({ message: "The process has no stdin" })
      if (data.length > 0 && (yield* Queue.isFull(stdin))) return yield* new StdinFullError({ id })
      const accepted = data.length === 0 || (yield* Queue.offer(stdin, data))
      if (!accepted) return yield* new OperationFailedError({ message: "The process’s stdin is closed" })
      if (end) yield* Queue.end(stdin)
    })

    const heartbeat = Effect.fn("Executor.heartbeat")(function* (brain: Brain.ID, id: ProcessID) {
      const entry = yield* find(brain, id)
      entry.isHeartbeating = true
    })

    const kill = Effect.fn("Executor.kill")(function* (
      brain: Brain.ID,
      id: ProcessID,
      name: Signal.Name,
      forceKillAfterMs?: number,
    ) {
      const entry = yield* find(brain, id)
      yield* entry.handle
        .kill({
          killSignal: name,
          ...(forceKillAfterMs && { forceKillAfter: Duration.millis(forceKillAfterMs) }),
        })
        .pipe(
          Effect.catch((error) => Effect.logWarning(`Executor.kill ${id} failed: ${error.message}`)),
          Effect.forkIn(entry.scope, { startImmediately: true }),
        )
    })

    return Executor.Service.of({
      hello: {
        protocol,
        version: manifest.version,
        environmentId: config.environmentId,
        os: process.platform,
        arch: process.arch,
        shells,
      },
      spawn,
      output,
      writeStdin,
      heartbeat,
      kill,
      read: Effect.fn("Executor.read")(function* (value: string, range?: Range) {
        const info = yield* describe(value, true)
        if (info.type !== "file") return yield* new WrongKindError({ path: value, actual: info.type })
        const found = yield* attemptFound(value, async () => {
          await using handle = await open(path(value), "r")
          const stats = await handle.stat()
          if (!range && stats.size > maxFileBytes) return { stats }
          const buffer = new Uint8Array(range ? Math.min(range.length, maxFileBytes) : stats.size)
          const result = await handle.read(buffer, 0, buffer.length, range ? range.offset : 0)
          return { stats, bytes: buffer.subarray(0, result.bytesRead) }
        })
        if (!found.bytes)
          return yield* new FileTooLargeError({ path: value, sizeBytes: found.stats.size, maxBytes: maxFileBytes })
        return {
          info: {
            type: info.type,
            sizeBytes: range ? found.stats.size : found.bytes.length,
            modifiedAtMs: found.stats.mtimeMs,
          },
          bytes: found.bytes,
        }
      }),
      write: (value, bytes) =>
        bytes.length > maxFileBytes
          ? Effect.fail(new FileTooLargeError({ path: value, sizeBytes: bytes.length, maxBytes: maxFileBytes }))
          : attempt(value, async () => {
              await mkdir(dirname(path(value)), { recursive: true })
              await writeFile(path(value), bytes)
            }),
      stat: (value) => describe(value, false),
      list: Effect.fn("Executor.list")(function* (value: string) {
        const info = yield* describe(value, true)
        if (info.type !== "directory") return yield* new WrongKindError({ path: value, actual: info.type })
        const entries = yield* attemptFound(value, () => readdir(path(value), { withFileTypes: true }))
        return entries.map((entry) => ({ name: entry.name, type: fileType(entry) }))
      }),
      remove: (value) => attempt(value, () => rm(path(value), { recursive: true, force: true })),
      move: Effect.fn("Executor.move")(function* (from: string, to: string) {
        yield* describe(from, false)
        const destination = yield* describe(to, false).pipe(
          Effect.map((info) => (info.type === "directory" ? join(path(to), basename(from)) : path(to))),
          Effect.catchTag("FileNotFoundError", () => Effect.succeed(path(to))),
        )
        yield* attempt(from, () => rename(path(from), destination))
      }),
      mkdir: (value) => attempt(value, () => mkdir(path(value), { recursive: true }).then(() => undefined)),
    })
  }),
)
