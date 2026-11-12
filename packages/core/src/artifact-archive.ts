export * as ArtifactArchive from "./artifact-archive.js"

import { GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3"
import { Artifact } from "@ren/schema/artifact"
import { Drive } from "@ren/schema/drive"
import { Effect, Schema, Stream } from "effect"
import type { ObjectStorage } from "./object-storage.js"

export class Failed extends Schema.TaggedError<Failed>()("ArtifactArchive.Failed", { message: Schema.String }) {}

export class Invalid extends Schema.TaggedError<Invalid>()("ArtifactArchive.Invalid", { message: Schema.String }) {}

const maxTarBytes = Artifact.maxTotalBytes + Artifact.maxFiles * 3 * 512 + 1024

const tooLarge = `Keep the archive at ${Artifact.maxFiles} files and ${Artifact.maxTotalBytes} bytes or fewer.`

const decodePaths = Schema.decodeUnknownEffect(Schema.Array(Drive.Path))

const decodeFiles = Schema.decodeUnknownEffect(Schema.toType(Artifact.Files))

export const read = Effect.fn("ArtifactArchive.read")(function* (storage: ObjectStorage.Interface, key: string) {
  const chunks: Array<Uint8Array> = []
  const read = { bytes: 0 }
  const version = yield* Effect.tryPromise({
    try: (signal) =>
      storage.s3.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }), { abortSignal: signal }),
    catch: (cause) =>
      cause instanceof NoSuchKey
        ? new Invalid({ message: "The upload has no archive. PUT the archive to its URL first." })
        : new Failed({ message: "Ren could not read the artifact source archive" }),
  }).pipe(
    Effect.flatMap((object) =>
      Stream.fromReadableStream({
        evaluate: () =>
          (object.Body?.transformToWebStream() ?? new Blob().stream()).pipeThrough(new DecompressionStream("gzip")),
        onError: () => new Invalid({ message: "The archive is not a .tar.gz." }),
      }).pipe(
        Stream.runForEachWhile((chunk) =>
          Effect.sync(() => {
            read.bytes += chunk.byteLength
            chunks.push(chunk)
            return read.bytes <= maxTarBytes
          }),
        ),
        Effect.as(object.ETag ?? ""),
      ),
    ),
    Effect.timeoutOrElse({
      duration: "60 seconds",
      orElse: () => Effect.fail(new Failed({ message: "Ren could not read the artifact source archive in time" })),
    }),
  )
  if (read.bytes > maxTarBytes) return yield* new Invalid({ message: tooLarge })
  const tar = Buffer.concat(chunks)
  const entries = yield* Effect.tryPromise({
    try: async () =>
      Promise.all(
        [...(await new Bun.Archive(tar).files()).values()].map(async (file) => ({
          name: file.name,
          bytes: await file.bytes(),
        })),
      ),
    catch: () => new Invalid({ message: "The archive is not a .tar.gz." }),
  })
  const roots = new Set(entries.map((entry) => entry.name.split("/").at(0)))
  if (roots.size !== 1 || entries.some((entry) => !entry.name.includes("/")))
    return yield* new Invalid({ message: "Put every file of the archive under one top-level folder." })
  const files = entries.map((entry) => ({ path: entry.name.slice(entry.name.indexOf("/") + 1), bytes: entry.bytes }))
  return {
    files: yield* decodePaths(files.map((file) => file.path)).pipe(
      Effect.andThen(decodeFiles(Object.fromEntries(files.map((file) => [file.path, file.bytes])))),
      Effect.mapError((error) => new Invalid({ message: `The archive’s files are not valid: ${error.message}` })),
    ),
    version,
  }
})
