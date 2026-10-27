export * as SandboxArchive from "./archive.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Deferred, Duration, Effect, Exit, Stream } from "effect"
import { type FileHandle, lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises"
import { basename, dirname, join, resolve, sep } from "node:path"

const decoder = new TextDecoder()

const field = (block: Uint8Array, start: number, length: number) =>
  decoder.decode(block.subarray(start, start + length)).replace(/\0[\s\S]*$/u, "")

const joined = (parts: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  parts.reduce((offset, part) => {
    out.set(part, offset)
    return offset + part.length
  }, 0)
  return out
}

// oxlint-disable-next-line ren/no-comments -- R40: an entry under the folder arrives as start, its bytes chunk by chunk, then end, so a large file never sits in memory.
type Event =
  | { readonly type: "start"; readonly path: string; readonly entry: string }
  | { readonly type: "bytes"; readonly bytes: Uint8Array }
  | { readonly type: "end" }

interface Header {
  readonly type: string
  readonly isEmitted: boolean
  readonly parts: Array<Uint8Array>
  remaining: number
  padding: number
}

interface Untar {
  buffer: Uint8Array
  header: Header | undefined
  name: string | undefined
}

const insideOf = (folder: string, name: string) => {
  const relative = name.slice(name.indexOf("/") + 1)
  if (folder === ".") return relative
  return relative.startsWith(`${folder}/`) ? relative.slice(folder.length + 1) : undefined
}

const readHeader = (folder: string, state: Untar, out: Array<Event>) => {
  if (state.buffer.length < 512) return false
  const block = state.buffer.subarray(0, 512)
  state.buffer = state.buffer.subarray(512)
  if (block.every((byte) => byte === 0)) return true
  const name = state.name ?? [field(block, 345, 155), field(block, 0, 100)].filter(Boolean).join("/")
  const size = Number.parseInt(field(block, 124, 12).trim() || "0", 8)
  const type = field(block, 156, 1) || "0"
  const inside = insideOf(folder, name)
  const isEmitted = Boolean(inside) && type !== "5" && type !== "g" && type !== "x" && type !== "L"
  state.name = undefined
  state.header = { type, isEmitted, parts: [], remaining: size, padding: (512 - (size % 512)) % 512 }
  if (isEmitted) out.push({ type: "start", path: inside ?? "", entry: type })
  return true
}

const readBody = (state: Untar, header: Header, out: Array<Event>) => {
  const take = Math.min(header.remaining + header.padding, state.buffer.length)
  const useful = Math.min(take, header.remaining)
  if (useful > 0 && header.isEmitted) out.push({ type: "bytes", bytes: state.buffer.slice(0, useful) })
  else if (useful > 0 && (header.type === "x" || header.type === "L")) header.parts.push(state.buffer.slice(0, useful))
  header.remaining -= useful
  header.padding -= take - useful
  state.buffer = state.buffer.subarray(take)
  return take > 0
}

const finish = (state: Untar, header: Header, out: Array<Event>) => {
  const bytes = joined(header.parts)
  if (header.type === "x") state.name = /(?:^|\n)\d+ path=([^\n]*)\n/u.exec(decoder.decode(bytes))?.at(1)
  else if (header.type === "L") state.name = decoder.decode(bytes).replace(/\0[\s\S]*$/u, "")
  else if (header.isEmitted) out.push({ type: "end" })
  state.header = undefined
  return true
}

// oxlint-disable-next-line ren/no-comments -- Reads a tar stream one chunk at a time and emits only the entries under the folder.
const untar =
  (folder: string) =>
  (previous: Untar, chunk: Uint8Array): readonly [Untar, ReadonlyArray<Event>] => {
    const state: Untar = { ...previous, buffer: joined([previous.buffer, chunk]) }
    const out: Array<Event> = []
    const advance = () => {
      const header = state.header
      if (!header) return readHeader(folder, state, out)
      if (header.remaining + header.padding > 0) return readBody(state, header, out)
      return finish(state, header, out)
    }
    let progressed = true
    while (progressed) progressed = advance()
    return [{ ...state, buffer: new Uint8Array(state.buffer) }, out]
  }

const isSafe = (path: string) =>
  path.length > 0 &&
  !path.includes("\0") &&
  path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")

export const stallAfter = Duration.seconds(60)

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

// oxlint-disable-next-line ren/no-comments -- Downloads into a staging folder beside the path and renames it at the end, so the path exists only with every file in it. R41: one download runs for each path; a second unpack waits for it, and downloads itself when the first was interrupted.
export const unpack = (workspace: string) => {
  const running = new Map<
    string,
    Deferred.Deferred<Exit.Exit<void, EnvironmentApi.ArchiveError | EnvironmentApi.FileSystemError>>
  >()
  const download = (input: EnvironmentApi.UnpackInput, target: string) =>
    Effect.gen(function* () {
      const failed = (message: string) => new EnvironmentApi.ArchiveError({ url: input.url, message })
      const fileSystem = (path: string) => (cause: unknown) =>
        new EnvironmentApi.FileSystemError({ path, message: messageOf(cause) })
      const staging = `${target}.${crypto.randomUUID()}.staging`
      const totals = { bytes: 0, files: 0 }
      const maxBytes = input.maxBytes ?? EnvironmentApi.maxUnpackBytes
      const maxFiles = input.maxFiles ?? EnvironmentApi.maxUnpackFiles
      const writing: { file: FileHandle | undefined; destination: string } = { file: undefined, destination: staging }
      const close = Effect.promise(async () => {
        await writing.file?.close().catch(() => undefined)
        writing.file = undefined
      })
      const start = (event: Extract<Event, { type: "start" }>) => {
        const isLink = event.entry === "1" || event.entry === "2"
        if (isLink && input.links === "skip") return Effect.void
        if (event.entry !== "0" && event.entry !== "7")
          return Effect.fail(
            failed(
              isLink
                ? `The archive has a link at ${event.path}, and the executor copies only files`
                : `The archive has a special file at ${event.path}, and the executor copies only files`,
            ),
          )
        const destination = resolve(staging, event.path)
        if (!isSafe(event.path) || !destination.startsWith(`${staging}${sep}`))
          return Effect.fail(failed(`The archive has a path outside its folder: ${event.path}`))
        totals.files += 1
        if (totals.files > maxFiles)
          return Effect.fail(failed(`The folder is larger than ${maxFiles} files or ${maxBytes} bytes`))
        return Effect.tryPromise({
          try: async () => {
            await mkdir(dirname(destination), { recursive: true })
            writing.destination = destination
            writing.file = await open(destination, "w")
          },
          catch: fileSystem(destination),
        })
      }
      const write = (
        event: Event,
      ): Effect.Effect<void, EnvironmentApi.ArchiveError | EnvironmentApi.FileSystemError> => {
        if (event.type === "start") return start(event)
        if (event.type === "end") return close
        const file = writing.file
        if (!file) return Effect.void
        totals.bytes += event.bytes.length
        if (totals.bytes > maxBytes)
          return Effect.fail(failed(`The folder is larger than ${maxFiles} files or ${maxBytes} bytes`))
        return Effect.tryPromise({ try: () => file.write(event.bytes), catch: fileSystem(writing.destination) })
      }
      const stalled = () => failed(`The archive sent no bytes for ${Duration.format(stallAfter)}`)
      yield* Effect.tryPromise({
        try: async () => {
          const parent = dirname(target)
          const prefix = `${basename(target)}.`
          const entries = await readdir(parent).catch(() => [])
          await Promise.all(
            entries
              .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".staging"))
              .map((entry) => rm(join(parent, entry), { recursive: true, force: true })),
          )
        },
        catch: fileSystem(target),
      })
      yield* Effect.tryPromise({
        try: (signal) => fetch(input.url, { headers: input.headers ?? {}, signal }),
        catch: (cause) => failed(`Could not download the archive: ${messageOf(cause)}`),
      }).pipe(
        Effect.timeoutOrElse({ duration: stallAfter, orElse: () => Effect.fail(stalled()) }),
        Effect.flatMap((response) =>
          response.ok && response.body
            ? Effect.succeed(response.body)
            : Effect.fail(failed(`The archive answered ${response.status}`)),
        ),
        Effect.flatMap((body) =>
          Stream.fromReadableStream({
            evaluate: () => body.pipeThrough(new DecompressionStream("gzip")),
            onError: (cause) => failed(`Could not read the archive: ${messageOf(cause)}`),
          }).pipe(
            Stream.timeoutOrElse({ duration: stallAfter, orElse: () => Stream.fail(stalled()) }),
            Stream.mapAccum(
              () => ({ buffer: new Uint8Array(), header: undefined, name: undefined }),
              untar(input.folder),
            ),
            Stream.runForEach(write),
          ),
        ),
        Effect.andThen(close),
        Effect.andThen(
          Effect.tryPromise({
            try: async () => {
              await mkdir(staging, { recursive: true })
              await rename(staging, target)
            },
            catch: fileSystem(target),
          }),
        ),
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : close.pipe(Effect.andThen(Effect.promise(() => rm(staging, { recursive: true, force: true })))),
        ),
      )
    })
  const isThere = (target: string) =>
    Effect.promise(() =>
      lstat(target).then(
        () => true,
        () => false,
      ),
    )
  const once = (
    input: EnvironmentApi.UnpackInput,
    target: string,
  ): Effect.Effect<void, EnvironmentApi.ArchiveError | EnvironmentApi.FileSystemError> =>
    Effect.suspend(() => {
      const current = running.get(target)
      if (current)
        return Deferred.await(current).pipe(
          Effect.flatMap((exit) => (Exit.hasInterrupts(exit) ? once(input, target) : exit)),
        )
      const done = Deferred.makeUnsafe<Exit.Exit<void, EnvironmentApi.ArchiveError | EnvironmentApi.FileSystemError>>()
      running.set(target, done)
      return Effect.flatMap(isThere(target), (isUnpacked) => (isUnpacked ? Effect.void : download(input, target))).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            running.delete(target)
            Deferred.doneUnsafe(done, Exit.succeed(exit))
          }),
        ),
      )
    })
  return Effect.fn("Executor.unpack")(function* (input: EnvironmentApi.UnpackInput) {
    yield* once(input, resolve(workspace, input.path))
  })
}
