export * as DriveFiles from "./drive-files.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import type { EnvironmentClient } from "@ren/environment-api/environment-client"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { Effect, Option, Schema } from "effect"
import { Mime } from "effect/http"

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
        const mime = Option.getOrElse(Mime.getType(file.path), () => "application/octet-stream")
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

export const note = (root: string, files: ReadonlyArray<SessionMessage.DriveFile>) =>
  [
    "The person attached these files. Each one is in the space’s drive, on the environment:",
    ...files.map(
      (file) => `- ${file.name} (${file.mime}, ${(file.size / 1_000_000).toFixed(1)} MB) at ${root}/${file.path}`,
    ),
  ].join("\n")
