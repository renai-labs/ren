export * as ArtifactArchive from "./artifact-archive.js"

import { GetObjectCommand } from "@aws-sdk/client-s3"
import type { Artifact } from "@ren/schema/artifact"
import { Effect, Schema } from "effect"
import type { ObjectStorage } from "./object-storage.js"

export class Failed extends Schema.TaggedError<Failed>()("ArtifactArchive.Failed", { message: Schema.String }) {}

export const read = Effect.fn("ArtifactArchive.read")(function* (storage: ObjectStorage.Interface, key: string) {
  return yield* Effect.tryPromise({
    try: async (signal): Promise<Artifact.Files> => {
      const object = await storage.s3.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }), {
        abortSignal: signal,
      })
      const archive = (await object.Body?.transformToByteArray()) ?? new Uint8Array()
      return Object.fromEntries(
        await Promise.all(
          [...(await new Bun.Archive(archive).files()).values()].map(
            async (file) => [file.name, await file.bytes()] as const,
          ),
        ),
      )
    },
    catch: () => new Failed({ message: "Ren could not read the artifact source archive" }),
  }).pipe(
    Effect.timeout("10 seconds"),
    Effect.mapError(() => new Failed({ message: "Ren could not read the artifact source archive" })),
  )
})
