export * as DriveFiles from "./drive-files.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import type { EnvironmentClient } from "@ren/environment-api/environment-client"
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

const read = (client: EnvironmentClient.Client, path: string, size: number) =>
  Effect.forEach(
    Array.from(
      { length: Math.ceil(size / EnvironmentApi.maxFileBytes) },
      (_, part) => part * EnvironmentApi.maxFileBytes,
    ),
    (offset) =>
      client["files.read"]({ path, range: { offset, length: Math.min(EnvironmentApi.maxFileBytes, size - offset) } }),
  ).pipe(
    Effect.map((parts) =>
      parts.reduce((all, part, index) => {
        all.set(part.bytes, index * EnvironmentApi.maxFileBytes)
        return all
      }, new Uint8Array(size)),
    ),
  )

export const attach = Effect.fn("DriveFiles.attach")(function* (
  client: EnvironmentClient.Client,
  root: string,
  files: ReadonlyArray<Session.DriveFile>,
) {
  yield* Effect.forEach(
    new Set(files.map((file) => `${root}/${file.path.slice(0, file.path.lastIndexOf("/"))}`)),
    (folder) => client["drives.refresh"]({ path: folder }).pipe(Effect.ignore),
    { concurrency: 4, discard: true },
  )
  return yield* Effect.forEach(
    files,
    (file) =>
      Effect.gen(function* () {
        const path = `${root}/${file.path}`
        const failed = (error: { readonly _tag: string; readonly message?: string }) =>
          new Refused({
            message:
              error._tag === "FileNotFoundError"
                ? `${file.name} is not in the space’s drive at ${file.path}`
                : `${file.name} could not be read from the space’s drive: ${error.message ?? error._tag}`,
          })
        const info = yield* client["files.stat"]({ path }).pipe(Effect.mapError(failed))
        if (info.type !== "file")
          return yield* new Refused({ message: `${file.name} is not a file in the space’s drive at ${file.path}` })
        const mime = Drive.typeOf(file.path)
        const size = info.sizeBytes
        const bytes =
          size <= Session.maxFileBytes && (mime.startsWith("text/") || readable.has(mime))
            ? Option.some(yield* read(client, path, size).pipe(Effect.mapError(failed)))
            : Option.none<Uint8Array>()
        return { file: { path: file.path, name: file.name, mime, size }, bytes }
      }),
    { concurrency: 4 },
  )
})

export const show = Effect.fn("DriveFiles.show")(function* (
  client: EnvironmentClient.Client,
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
