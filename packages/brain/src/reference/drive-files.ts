export * as DriveFiles from "./drive-files.js"

import { HandApi } from "@ren/hand-api/hand-api"
import type { HandClient } from "@ren/hand-api/hand-client"
import { Drive } from "@ren/schema/drive"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { ByteSize, Effect, Option, Schema } from "effect"

export class Refused extends Schema.TaggedError<Refused>()("DriveFiles.Refused", { message: Schema.String }) {}

export interface Attached {
  readonly file: SessionMessage.DriveFile
  readonly bytes: Option.Option<Uint8Array>
}

const readable = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "application/json"])

const read = (client: HandClient.Client, path: string, size: number) =>
  Effect.forEach(
    Array.from({ length: Math.ceil(size / HandApi.maxFileBytes) }, (_, part) => part * HandApi.maxFileBytes),
    (offset) =>
      client["files.read"]({ path, range: { offset, length: Math.min(HandApi.maxFileBytes, size - offset) } }),
  ).pipe(
    Effect.map((parts) =>
      parts.reduce((all, part, index) => {
        all.set(part.bytes, index * HandApi.maxFileBytes)
        return all
      }, new Uint8Array(size)),
    ),
  )

export const attach = Effect.fn("DriveFiles.attach")(function* (
  client: HandClient.Client,
  root: string,
  files: ReadonlyArray<Session.DriveFile>,
) {
  yield* Effect.forEach(
    new Set(files.map((file) => `${root}/${file.path.slice(0, file.path.lastIndexOf("/"))}`)),
    (folder) => client["drives.refresh"]({ path: folder }).pipe(Effect.ignore),
    { concurrency: 4, discard: true },
  )
  const failed = (file: Session.DriveFile) => (error: { readonly _tag: string; readonly message?: string }) =>
    new Refused({
      message:
        error._tag === "FileNotFoundError"
          ? `${file.name} is not in the space’s drive at ${file.path}`
          : `${file.name} could not be read from the space’s drive: ${error.message ?? error._tag}`,
    })
  const found = yield* Effect.forEach(
    files,
    (file) =>
      Effect.gen(function* () {
        const info = yield* client["files.stat"]({ path: `${root}/${file.path}` }).pipe(Effect.mapError(failed(file)))
        if (info.type !== "file")
          return yield* new Refused({ message: `${file.name} is not a file in the space’s drive at ${file.path}` })
        const mime = Drive.typeOf(file.path)
        const size = info.sizeBytes
        const isInlined = size <= Session.inlineLimitOf(mime) && (mime.startsWith("text/") || readable.has(mime))
        return { source: file, file: { path: file.path, name: file.name, mime, size }, isInlined }
      }),
    { concurrency: 4 },
  )
  // oxlint-disable-next-line ren/no-comments -- As for files sent inline, a message's files come with their bytes up to Session.maxInlineBytes in all, in order; the rest come with their path only.
  const inlined = found.reduce(
    (sum, each) =>
      each.isInlined && sum.bytes + each.file.size <= Session.maxInlineBytes
        ? { bytes: sum.bytes + each.file.size, paths: new Set([...sum.paths, each.file.path]) }
        : sum,
    { bytes: 0, paths: new Set<string>() },
  ).paths
  return yield* Effect.forEach(
    found,
    (each) =>
      Effect.map(
        inlined.has(each.file.path)
          ? Effect.map(
              read(client, `${root}/${each.file.path}`, each.file.size).pipe(Effect.mapError(failed(each.source))),
              Option.some,
            )
          : Effect.succeed(Option.none<Uint8Array>()),
        (bytes): Attached => ({ file: each.file, bytes }),
      ),
    { concurrency: 4 },
  )
})

export const show = Effect.fn("DriveFiles.show")(function* (
  client: HandClient.Client,
  root: string,
  sessionId: string,
  source: string,
) {
  const name = source.slice(source.lastIndexOf("/") + 1)
  const path = `${Drive.outputsOf(sessionId)}/${name}`
  const target = `${root}/${path}`
  const reasons: Readonly<Record<string, string>> = {
    FileNotFoundError: `${source} does not exist`,
    WrongKindError: `${source} is not a file`,
  }
  const failed = (error: { readonly _tag: string; readonly message?: string }) =>
    new Refused({
      message: reasons[error._tag] ?? `${source} could not be put in the space’s drive: ${error.message ?? error._tag}`,
    })
  if (source !== target) yield* client["files.copy"]({ from: source, to: target }).pipe(Effect.mapError(failed))
  const info = yield* client["files.stat"]({ path: target }).pipe(Effect.mapError(failed))
  if (info.sizeBytes > Drive.maxFileBytes)
    return yield* new Refused({ message: `${name} is larger than the space’s drive takes (100 MiB)` })
  yield* client["drives.uploaded"]({ path: target }).pipe(
    Effect.mapError((error) => new Refused({ message: `${name} did not reach the space’s drive: ${error.message}` })),
  )
  return { path, name, mime: Drive.typeOf(path), size: info.sizeBytes } satisfies SessionMessage.DriveFile
})

export const note = (root: string, files: ReadonlyArray<SessionMessage.DriveFile>) =>
  [
    "The person attached these files. Each one is in the space’s drive, on the environment:",
    ...files.map(
      (file) =>
        `- ${file.name} (${file.mime}, ${ByteSize.format(ByteSize.bytes(file.size), { system: "decimal", precision: 1 })}) at ${root}/${file.path}`,
    ),
  ].join("\n")
