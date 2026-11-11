export * as TestBundles from "./bundles.js"

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Bundle } from "@ren/schema/bundle"
import { Effect, Schema } from "effect"
import { TestDrives } from "./drives.js"

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: TestDrives.config.DRIVE_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: TestDrives.config.DRIVE_ACCESS_KEY_ID,
    secretAccessKey: TestDrives.config.DRIVE_SECRET_ACCESS_KEY,
  },
})

// oxlint-disable-next-line ren/no-comments -- A bucket of its own in the test S3 server, as the deploy fills one, and the config that points Bundles at it. It is emptied and deleted when the scope closes.
export const bucket = Effect.acquireRelease(
  Effect.promise(async () => {
    const name = `ren-bundles-${crypto.randomUUID().slice(0, 8)}`
    await s3.send(new CreateBucketCommand({ Bucket: name }))
    const put = (key: string, body: string | Uint8Array) =>
      Effect.promise(() => s3.send(new PutObjectCommand({ Bucket: name, Key: `bundles/${key}`, Body: body })))
    return {
      name,
      config: {
        BUNDLE_BUCKET: name,
        BUNDLE_ENDPOINT: TestDrives.config.DRIVE_ENDPOINT,
        BUNDLE_ACCESS_KEY_ID: TestDrives.config.DRIVE_ACCESS_KEY_ID,
        BUNDLE_SECRET_ACCESS_KEY: TestDrives.config.DRIVE_SECRET_ACCESS_KEY,
      },
      put,
      // oxlint-disable-next-line ren/no-comments -- What a deploy does last: it makes these bundles current.
      publish: (bundles: ReadonlyArray<Bundle.Info>) =>
        put(Bundle.manifestKey, Schema.encodeSync(Schema.fromJsonString(Bundle.Manifest))({ bundles })),
    }
  }),
  (found) =>
    Effect.promise(async () => {
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: found.name }))
      const keys = (listed.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []))
      if (keys.length > 0) await s3.send(new DeleteObjectsCommand({ Bucket: found.name, Delete: { Objects: keys } }))
      await s3.send(new DeleteBucketCommand({ Bucket: found.name }))
    }),
)
