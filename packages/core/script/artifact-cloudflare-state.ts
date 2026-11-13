import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { Artifact } from "@ren/schema/artifact"
import { and, eq, isNull, or, sql } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { ArtifactCloudflare } from "../src/artifact-provider/cloudflare.js"
import { ObjectStorage } from "../src/object-storage.js"

// oxlint-disable-next-line ren/no-comments -- One-time copy for the release that moves the Cloudflare provider's state from the drive bucket into artifact.remote. Run it once after the migration, with the server's environment: `bun /repo/packages/core/script/artifact-cloudflare-state.ts` lists what it would copy, and `--write` copies. It writes only a row whose remote is empty or still the old binding, so a second run changes nothing.
const prefix = "artifact-provider/cloudflare/"

const program = Effect.gen(function* () {
  const write = process.argv.includes("--write")
  const storage = yield* ObjectStorage.Service
  const database = yield* Database.Service
  const artifacts = Database.Schema.artifact
  const listed = yield* Effect.promise(() =>
    storage.s3.send(new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: prefix })),
  )
  if (listed.IsTruncated) return yield* Effect.die(new Error(`More than one page of objects under ${prefix}`))
  const keys = (listed.Contents ?? []).flatMap((object) => (object.Key?.endsWith("/state.json") ? [object.Key] : []))
  const copied = yield* Effect.forEach(keys, (key) =>
    Effect.gen(function* () {
      const id = yield* Schema.decodeUnknownEffect(Artifact.ID)(key.slice(prefix.length, -"/state.json".length))
      const body = yield* Effect.promise(() =>
        storage.s3
          .send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }))
          .then((object) => object.Body?.transformToString() ?? ""),
      )
      const state = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ArtifactCloudflare.State))(body).pipe(
        Effect.flatMap(Schema.encodeEffect(Schema.toCodecJson(ArtifactCloudflare.State))),
      )
      const target = and(
        eq(artifacts.id, id),
        eq(artifacts.provider, ArtifactCloudflare.id),
        or(isNull(artifacts.remote), sql`${artifacts.remote} ->> 'version' is null`),
      )
      const rows = write
        ? yield* database.db
            .update(artifacts)
            .set({ remote: state, remote_version: sql`${artifacts.remote_version} + 1` })
            .where(target)
            .returning({ id: artifacts.id })
        : yield* database.db.select({ id: artifacts.id }).from(artifacts).where(target)
      const action = write ? "copied" : "would copy"
      yield* Effect.log(`${id}: ${rows.length ? action : "skipped, already copied or no row"}`)
      return rows.length
    }),
  )
  yield* Effect.log(
    `${keys.length} state objects; ${copied.reduce((total, count) => total + count, 0)} ${write ? "copied" : "to copy"}.`,
  )
})

await Effect.runPromise(
  program.pipe(Effect.provide(Layer.mergeAll(Database.layer.pipe(Layer.provide(Postgres.layer)), ObjectStorage.layer))),
)
