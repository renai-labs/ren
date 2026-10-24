export * as SandboxArchive from "./archive.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Effect, Stream } from "effect"
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"

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

interface Entry {
  readonly path: string
  readonly type: string
  readonly bytes: Uint8Array
}

interface Header {
  readonly path: string
  readonly keep: boolean
  readonly type: string
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

const readHeader = (folder: string, state: Untar) => {
  if (state.buffer.length < 512) return false
  const block = state.buffer.subarray(0, 512)
  state.buffer = state.buffer.subarray(512)
  if (block.every((byte) => byte === 0)) return true
  const name = state.name ?? [field(block, 345, 155), field(block, 0, 100)].filter(Boolean).join("/")
  const size = Number.parseInt(field(block, 124, 12).trim() || "0", 8)
  const type = field(block, 156, 1) || "0"
  const inside = insideOf(folder, name)
  state.name = undefined
  state.header = {
    path: inside ?? "",
    keep: type === "x" || type === "L" || (Boolean(inside) && type !== "5" && type !== "g"),
    type,
    parts: [],
    remaining: size,
    padding: (512 - (size % 512)) % 512,
  }
  return true
}

const readBody = (state: Untar, header: Header) => {
  const take = Math.min(header.remaining + header.padding, state.buffer.length)
  const useful = Math.min(take, header.remaining)
  if (header.keep && useful > 0) header.parts.push(state.buffer.slice(0, useful))
  header.remaining -= useful
  header.padding -= take - useful
  state.buffer = state.buffer.subarray(take)
  return take > 0
}

const finish = (state: Untar, header: Header, out: Array<Entry>) => {
  const bytes = joined(header.parts)
  if (header.type === "x") state.name = /(?:^|\n)\d+ path=([^\n]*)\n/u.exec(decoder.decode(bytes))?.at(1)
  else if (header.type === "L") state.name = decoder.decode(bytes).replace(/\0[\s\S]*$/u, "")
  else if (header.keep) out.push({ path: header.path, type: header.type, bytes })
  state.header = undefined
  return true
}

// oxlint-disable-next-line ren/no-comments -- Reads a tar stream one chunk at a time and keeps only the bytes of entries under the folder, so a whole repository never sits in memory.
const untar =
  (folder: string) =>
  (previous: Untar, chunk: Uint8Array): readonly [Untar, ReadonlyArray<Entry>] => {
    const state: Untar = { ...previous, buffer: joined([previous.buffer, chunk]) }
    const out: Array<Entry> = []
    const advance = () => {
      const header = state.header
      if (!header) return readHeader(folder, state)
      if (header.remaining + header.padding > 0) return readBody(state, header)
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

// oxlint-disable-next-line ren/no-comments -- Downloads into a staging folder beside the path and renames it at the end, so the path exists only with every file in it.
export const unpack = (workspace: string) =>
  Effect.fn("Executor.unpack")(function* (input: EnvironmentApi.UnpackInput) {
    const target = resolve(workspace, input.path)
    const failed = (message: string) => new EnvironmentApi.ArchiveError({ url: input.url, message })
    const exists = yield* Effect.promise(() =>
      lstat(target).then(
        () => true,
        () => false,
      ),
    )
    if (exists) return
    const staging = `${target}.${crypto.randomUUID()}.staging`
    const totals = { bytes: 0, files: 0 }
    const write = (entry: Entry): Effect.Effect<void, EnvironmentApi.ArchiveError | EnvironmentApi.FileSystemError> => {
      if (entry.type !== "0" && entry.type !== "7")
        return Effect.fail(
          failed(
            entry.type === "1" || entry.type === "2"
              ? `The archive has a link at ${entry.path}, and the executor copies only files`
              : `The archive has a special file at ${entry.path}, and the executor copies only files`,
          ),
        )
      const destination = resolve(staging, entry.path)
      if (!isSafe(entry.path) || !destination.startsWith(`${staging}${sep}`))
        return Effect.fail(failed(`The archive has a path outside its folder: ${entry.path}`))
      totals.bytes += entry.bytes.length
      totals.files += 1
      if (totals.bytes > EnvironmentApi.maxUnpackBytes || totals.files > EnvironmentApi.maxUnpackFiles)
        return Effect.fail(
          failed(
            `The folder is larger than ${EnvironmentApi.maxUnpackFiles} files or ${EnvironmentApi.maxUnpackBytes} bytes`,
          ),
        )
      return Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(destination), { recursive: true })
          await writeFile(destination, entry.bytes)
        },
        catch: (cause) =>
          new EnvironmentApi.FileSystemError({
            path: destination,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      })
    }
    yield* Effect.tryPromise({
      try: () => fetch(input.url),
      catch: (cause) =>
        failed(`Could not download the archive: ${cause instanceof Error ? cause.message : String(cause)}`),
    }).pipe(
      Effect.flatMap((response) =>
        response.ok && response.body
          ? Effect.succeed(response.body)
          : Effect.fail(failed(`The archive answered ${response.status}`)),
      ),
      Effect.flatMap((body) =>
        Stream.fromReadableStream({
          evaluate: () => body.pipeThrough(new DecompressionStream("gzip")),
          onError: (cause) =>
            failed(`Could not read the archive: ${cause instanceof Error ? cause.message : String(cause)}`),
        }).pipe(
          Stream.mapAccum(
            () => ({ buffer: new Uint8Array(), header: undefined, name: undefined }),
            untar(input.folder),
          ),
          Stream.runForEach(write),
        ),
      ),
      Effect.andThen(
        Effect.tryPromise({
          try: async () => {
            await mkdir(staging, { recursive: true })
            await rename(staging, target)
          },
          catch: (cause) =>
            new EnvironmentApi.FileSystemError({
              path: target,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        }),
      ),
      Effect.onError(() => Effect.promise(() => rm(staging, { recursive: true, force: true }))),
    )
  })
