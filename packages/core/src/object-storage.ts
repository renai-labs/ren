export * as ObjectStorage from "./object-storage.js"

import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"

export interface Interface {
  readonly s3: S3Client
  readonly bucket: string
  readonly region: string
  readonly endpoint: Option.Option<string>
  readonly client: S3ClientConfig
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ObjectStorage") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      bucket: Config.String("DRIVE_BUCKET"),
      region: Config.String("DRIVE_REGION").pipe(Config.withDefault("us-east-1")),
      endpoint: Config.option(Config.String("DRIVE_ENDPOINT")),
      accessKeyId: Config.option(Config.String("DRIVE_ACCESS_KEY_ID")),
      secretAccessKey: Config.option(Config.Redacted("DRIVE_SECRET_ACCESS_KEY")),
    })
    const client = {
      region: config.region,
      ...(Option.isSome(config.endpoint) && { endpoint: config.endpoint.value }),
      ...(Option.isSome(config.accessKeyId) &&
        Option.isSome(config.secretAccessKey) && {
          credentials: {
            accessKeyId: config.accessKeyId.value,
            secretAccessKey: Redacted.value(config.secretAccessKey.value),
          },
        }),
    }
    const s3 = new S3Client({ ...client, forcePathStyle: Option.isSome(config.endpoint) })
    yield* Effect.addFinalizer(() => Effect.sync(() => s3.destroy()))
    return Service.of({ s3, bucket: config.bucket, region: config.region, endpoint: config.endpoint, client })
  }),
)
