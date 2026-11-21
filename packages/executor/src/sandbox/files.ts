export * as SandboxFiles from "./files.js"

import { HandApi } from "@ren/hand-api/hand-api"
import { Effect } from "effect"
import { copyFile, lstat, mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const isMissing = (cause: unknown) =>
  cause instanceof Error && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR")

const fileType = (entry: {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}): HandApi.FileType => {
  if (entry.isFile()) return "file"
  if (entry.isDirectory()) return "directory"
  if (entry.isSymbolicLink()) return "symlink"
  return "other"
}

const attempt = <A>(path: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new HandApi.FileSystemError({ path, message: message(cause) }),
  })

const attemptFound = <A>(path: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      isMissing(cause)
        ? new HandApi.FileNotFoundError({ path })
        : new HandApi.FileSystemError({ path, message: message(cause) }),
  })

export const make = (workspace: string) => {
  const path = (value: string) => resolve(workspace, value)
  const fileInfo = (value: string, options: { readonly followLink: boolean }) =>
    attemptFound(value, () => (options.followLink ? stat(path(value)) : lstat(path(value)))).pipe(
      Effect.map((stats): HandApi.FileInfo => ({
        type: fileType(stats),
        sizeBytes: stats.size,
        modifiedAtMs: stats.mtimeMs,
      })),
    )
  return {
    read: Effect.fn("Executor.read")(function* (value: string, range?: HandApi.Range) {
      const info = yield* fileInfo(value, { followLink: true })
      if (info.type !== "file") return yield* new HandApi.WrongKindError({ path: value, actual: info.type })
      const found = yield* attemptFound(value, async () => {
        await using handle = await open(path(value), "r")
        const stats = await handle.stat()
        if (!range && stats.size > HandApi.maxFileBytes) return { stats }
        const buffer = new Uint8Array(range ? Math.min(range.length, HandApi.maxFileBytes) : stats.size)
        const result = await handle.read(buffer, 0, buffer.length, range ? range.offset : 0)
        return { stats, bytes: buffer.subarray(0, result.bytesRead) }
      })
      if (!found.bytes)
        return yield* new HandApi.FileTooLargeError({
          path: value,
          sizeBytes: found.stats.size,
          maxBytes: HandApi.maxFileBytes,
        })
      return {
        info: {
          type: info.type,
          sizeBytes: range ? found.stats.size : found.bytes.length,
          modifiedAtMs: found.stats.mtimeMs,
        },
        bytes: found.bytes,
      }
    }),
    write: Effect.fn("Executor.write")(function* (value: string, bytes: Uint8Array) {
      if (bytes.length > HandApi.maxFileBytes)
        return yield* new HandApi.FileTooLargeError({
          path: value,
          sizeBytes: bytes.length,
          maxBytes: HandApi.maxFileBytes,
        })
      yield* attempt(value, async () => {
        await mkdir(dirname(path(value)), { recursive: true })
        await writeFile(path(value), bytes)
      })
    }),
    stat: Effect.fn("Executor.stat")((value: string) => fileInfo(value, { followLink: false })),
    list: Effect.fn("Executor.list")(function* (value: string) {
      const info = yield* fileInfo(value, { followLink: true })
      if (info.type !== "directory") return yield* new HandApi.WrongKindError({ path: value, actual: info.type })
      const entries = yield* attemptFound(value, () => readdir(path(value), { withFileTypes: true }))
      return entries.map((entry) => ({ name: entry.name, type: fileType(entry) }))
    }),
    remove: Effect.fn("Executor.remove")((value: string) =>
      attempt(value, () => rm(path(value), { recursive: true, force: true })),
    ),
    move: Effect.fn("Executor.move")(function* (from: string, to: string) {
      yield* fileInfo(from, { followLink: false })
      const destination = yield* fileInfo(to, { followLink: false }).pipe(
        Effect.map((info) => (info.type === "directory" ? join(path(to), basename(from)) : path(to))),
        Effect.catchTag("FileNotFoundError", () => Effect.succeed(path(to))),
      )
      yield* attempt(from, () => rename(path(from), destination))
    }),
    copy: Effect.fn("Executor.copy")(function* (from: string, to: string) {
      const info = yield* fileInfo(from, { followLink: true })
      if (info.type !== "file") return yield* new HandApi.WrongKindError({ path: from, actual: info.type })
      yield* attempt(to, async () => {
        await mkdir(dirname(path(to)), { recursive: true })
        await copyFile(path(from), path(to))
      })
    }),
    mkdir: Effect.fn("Executor.mkdir")((value: string) =>
      attempt(value, () => mkdir(path(value), { recursive: true }).then(() => undefined)),
    ),
  }
}
