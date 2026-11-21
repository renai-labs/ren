import { describe, expect } from "bun:test"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { Artifact } from "@ren/schema/artifact"
import { Effect, Layer } from "effect"
import { ArtifactArchive } from "../src/artifact-archive.js"
import { ObjectStorage } from "../src/object-storage.js"
import { ArtifactSamples } from "./lib/artifact-samples.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(ObjectStorage.layer.pipe(Layer.provide(TestDrives.layer)))

const stored = (body: Uint8Array) =>
  Effect.gen(function* () {
    const storage = yield* ObjectStorage.Service
    const key = `test/artifacts/${crypto.randomUUID()}.tar.gz`
    yield* Effect.promise(() => storage.s3.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: body })))
    return yield* ArtifactArchive.read(storage, key).pipe(Effect.flip)
  })

describe("ArtifactArchive", () => {
  it.live(
    "refuses an archive with a file over the limit, a path out of its folder, files outside one folder, or bytes that are not one",
    () =>
      Effect.gen(function* () {
        const large = yield* Effect.promise(() =>
          ArtifactSamples.archive({ "index.html": "x", "video.mp4": new Uint8Array(Artifact.maxFileBytes + 1) }),
        )
        const escaping = yield* Effect.promise(() =>
          ArtifactSamples.archive({ "index.html": "x", "../escape.txt": "y" }),
        )
        const flat = yield* Effect.promise(() =>
          new Bun.Archive({ "index.html": "x", "site/app.js": "y" }, { compress: "gzip" }).bytes(),
        )
        expect([
          (yield* stored(large)).message,
          (yield* stored(escaping)).message,
          (yield* stored(flat)).message,
          (yield* stored(new TextEncoder().encode("<h1>not an archive</h1>"))).message,
        ]).toEqual([
          expect.stringContaining(`Expected a value with a length of at most ${Artifact.maxFileBytes}`),
          expect.stringContaining("with no empty, . or .. part"),
          "Put every file of the archive under one top-level folder.",
          "The archive is not a .tar.gz.",
        ])
      }),
  )
})
