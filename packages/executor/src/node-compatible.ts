export * as NodeCompatible from "./node-compatible.js"

import {
  exitedKeptFor,
  type FileInfo,
  FileNotFoundError,
  FileTooLargeError,
  type FileType,
  maxFileBytes,
  OperationFailedError,
  orphanAfter,
  pingEvery,
  type ProcessEvent,
  ProcessID,
  ProcessNotFoundError,
  protocol,
  type Range,
  type SpawnInput,
  stallAfter,
  StdinFullError,
  WrongKindError,
} from "@ren/brain-api/executor-api"
import { Signal } from "@ren/brain-api/signal"
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
  PubSub,
  Queue,
  Schedule,
  Schema,
  Scope,
  Stream,
} from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { constants } from "node:fs"
import { access, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import manifest from "../package.json"
import { Executor } from "./executor.js"

export const logLimitBytes = 2 * 1024 * 1024

export const exitedLimitBytes = 64 * 1024 * 1024

type OutputEvent = Extract<ProcessEvent, { readonly type: "stdout" | "stderr" }>

type ExitEvent = Extract<ProcessEvent, { readonly type: "exit" }>

interface Entry {
  readonly id: ProcessID
  readonly brain: Brain.ID
  readonly scope: Scope.Closeable
  readonly handle: ChildProcessSpawner.ChildProcessHandle
  readonly stdin: Queue.Queue<Uint8Array, Cause.Done> | undefined
  readonly chunks: Array<OutputEvent>
  readonly readerPositions: Map<object, number>
  readonly logChanged: PubSub.PubSub<void>
  readonly readerMoves: PubSub.Subscription<void>
  readonly readerMoved: PubSub.PubSub<void>
  nextOffset: number
  exit: ExitEvent | undefined
  failure: Cause.Cause<never> | undefined
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

    const trim: (entry: Entry) => Effect.Effect<void> = Effect.fnUntraced(function* (entry: Entry) {
      const first = entry.chunks.at(0)
      if (!first || entry.chunks.length === 1 || entry.nextOffset - first.offset <= logLimitBytes) return
      const end = first.offset + first.bytes.length
      if ([...entry.readerPositions.values()].some((position) => position < end)) {
        const moved = yield* PubSub.take(entry.readerMoves).pipe(Effect.timeoutOption(stallAfter))
        if (Option.isSome(moved)) return yield* trim(entry)
        for (const reader of entry.readerPositions.keys())
          if ((entry.readerPositions.get(reader) ?? end) < end) entry.readerPositions.delete(reader)
      }
      entry.chunks.shift()
      return yield* trim(entry)
    })

    const keptBytes = (entry: Entry) => entry.chunks.reduce((bytes, chunk) => bytes + chunk.bytes.length, 0)

    const recordExit = Effect.fnUntraced(function* (entry: Entry, event: ExitEvent) {
      entry.exit = event
      entry.seenAtMs = yield* Clock.currentTimeMillis
      yield* PubSub.publish(entry.logChanged, undefined)
      exitOrder.push(entry.id)
      const exited = exitOrder.flatMap((id) => {
        const found = processes.get(id)
        return found ? [found] : []
      })
      const total = exited.reduce((bytes, found) => bytes + keptBytes(found), 0)
      const oldest = exited.reduce<{ readonly bytes: number; readonly entries: ReadonlyArray<Entry> }>(
        (dropped, found) =>
          total - dropped.bytes > exitedLimitBytes
            ? { bytes: dropped.bytes + keptBytes(found), entries: [...dropped.entries, found] }
            : dropped,
        { bytes: 0, entries: [] },
      )
      yield* Effect.forEach(oldest.entries, release, { discard: true })
    })

    const outputFrom = (entry: Entry, position: number) =>
      entry.chunks.flatMap((chunk): ReadonlyArray<OutputEvent> => {
        if (chunk.offset + chunk.bytes.length <= position) return []
        if (chunk.offset >= position) return [chunk]
        return [{ ...chunk, offset: position, bytes: chunk.bytes.subarray(position - chunk.offset) }]
      })

    const waitForChange: (
      entry: Entry,
      position: number,
      logChanges: PubSub.Subscription<void>,
    ) => Effect.Effect<void> = Effect.fnUntraced(function* (entry, position, logChanges) {
      if (entry.nextOffset > position || entry.exit || entry.failure) return
      yield* PubSub.take(logChanges)
      return yield* waitForChange(entry, position, logChanges)
    })

    yield* Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const orphans = [...processes.values()].filter((entry) =>
        entry.exit
          ? entry.readerPositions.size === 0 && now - entry.seenAtMs >= Duration.toMillis(exitedKeptFor)
          : (entry.readerPositions.size === 0 || entry.isHeartbeating) &&
            now - entry.seenAtMs >= Duration.toMillis(orphanAfter),
      )
      yield* Effect.forEach(orphans, release, { discard: true })
    }).pipe(Effect.repeat(Schedule.spaced(Duration.seconds(1))), Effect.forkIn(scope))

    const spawn = Effect.fn("Executor.spawn")(function* (brain: Brain.ID, input: SpawnInput) {
      const entryScope = yield* Scope.fork(scope)
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
          Effect.onError(() => Scope.close(entryScope, Exit.void)),
        )
      const id = ProcessID.create()
      const readerMoved = yield* PubSub.sliding<void>(1)
      const entry: Entry = {
        id,
        brain,
        scope: entryScope,
        handle,
        stdin,
        chunks: [],
        readerPositions: new Map(),
        logChanged: yield* PubSub.sliding<void>(1),
        readerMoves: yield* PubSub.subscribe(readerMoved).pipe(Scope.provide(entryScope)),
        readerMoved,
        nextOffset: 0,
        exit: undefined,
        failure: undefined,
        seenAtMs: yield* Clock.currentTimeMillis,
        isHeartbeating: false,
      }
      processes.set(id, entry)
      const tagged = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>, type: OutputEvent["type"]) =>
        stream.pipe(
          Stream.map((bytes) => ({ type, bytes })),
          Stream.ignore,
        )
      yield* Stream.merge(tagged(handle.stdout, "stdout"), tagged(handle.stderr, "stderr")).pipe(
        Stream.runForEach((written) =>
          Effect.gen(function* () {
            entry.chunks.push({ ...written, offset: entry.nextOffset })
            entry.nextOffset += written.bytes.length
            yield* PubSub.publish(entry.logChanged, undefined)
            yield* trim(entry)
          }),
        ),
        Effect.andThen(
          handle.exitCode.pipe(
            Effect.map((exitCode): ExitEvent => ({ type: "exit", exitCode, signal: null })),
            Effect.catch((error) =>
              Option.match(killedBy(error), {
                onSome: (signal) => Effect.succeed<ExitEvent>({ type: "exit", exitCode: null, signal }),
                onNone: () => Effect.die(error),
              }),
            ),
          ),
        ),
        Effect.flatMap((event) => recordExit(entry, event)),
        Effect.andThen(stdin ? Queue.shutdown(stdin) : Effect.void),
        Effect.onError((cause) =>
          Effect.sync(() => {
            entry.failure = cause
          }).pipe(Effect.andThen(PubSub.publish(entry.logChanged, undefined))),
        ),
        Effect.forkIn(entryScope),
      )
      return { id, pid: handle.pid }
    })

    const output = Effect.fn("Executor.output")(function* (brain: Brain.ID, id: ProcessID, cursor?: number) {
      const entry = yield* find(brain, id)
      const reader = {}
      const leave = Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) => {
          entry.readerPositions.delete(reader)
          entry.seenAtMs = now
          return PubSub.publish(entry.readerMoved, undefined)
        }),
      )
      const events = Stream.unwrap(
        Effect.map(PubSub.subscribe(entry.logChanged), (logChanges) =>
          Stream.paginate(cursor ?? 0, (position: number) =>
            Effect.gen(function* () {
              entry.readerPositions.set(reader, position)
              yield* PubSub.publish(entry.readerMoved, undefined)
              yield* waitForChange(entry, position, logChanges)
              if (entry.failure) return yield* Effect.failCause(entry.failure)
              const chunks = outputFrom(entry, position)
              if (entry.exit) return [[...chunks, entry.exit], Option.none<number>()] as const
              return [chunks, Option.some(entry.nextOffset)] as const
            }),
          ),
        ),
      )
      return events.pipe(
        Stream.merge(Stream.tick(pingEvery).pipe(Stream.drop(1), Stream.as({ type: "ping" as const })), {
          haltStrategy: "left",
        }),
        Stream.ensuring(leave),
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
        capabilities: ["processes", "files"],
        environmentId: config.environmentId,
        workspaceDirectory: workspace,
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
        if (!range && info.sizeBytes > maxFileBytes)
          return yield* new FileTooLargeError({ path: value, sizeBytes: info.sizeBytes, maxBytes: maxFileBytes })
        if (!range) return { info, bytes: new Uint8Array(yield* attemptFound(value, () => readFile(path(value)))) }
        const bytes = yield* attemptFound(value, async () => {
          const handle = await open(path(value), "r")
          const buffer = new Uint8Array(range.length)
          await using closing = handle
          const result = await closing.read(buffer, 0, range.length, range.offset)
          return buffer.subarray(0, result.bytesRead)
        })
        return { info, bytes }
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
