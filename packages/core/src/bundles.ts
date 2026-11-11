export * as Bundles from "./bundles.js"

import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Bundle } from "@ren/schema/bundle"
import { Config, Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"

export interface Interface {
  // oxlint-disable-next-line ren/no-comments -- The bundles the deploy made current; none for a Ren whose machines run Ren's code from their image or folder.
  readonly current: Effect.Effect<Option.Option<ReadonlyArray<Bundle.Info>>>
  // oxlint-disable-next-line ren/no-comments -- Links that download the bundles for a short time, with the folder each one unpacks into.
  readonly downloads: (bundles: ReadonlyArray<Bundle.Info>) => Effect.Effect<ReadonlyArray<Bundle.Download>>
  // oxlint-disable-next-line ren/no-comments -- The host the links point to. A machine with a host list must reach it.
  readonly host: Option.Option<string>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Bundles") {}

const linkLifetime = Duration.minutes(15)

const folder = "bundles/"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      bucket: Config.option(Config.String("BUNDLE_BUCKET")),
      region: Config.String("BUNDLE_REGION").pipe(Config.withDefault("us-east-1")),
      endpoint: Config.option(Config.String("BUNDLE_ENDPOINT")),
      accessKeyId: Config.option(Config.String("BUNDLE_ACCESS_KEY_ID")),
      secretAccessKey: Config.option(Config.Redacted("BUNDLE_SECRET_ACCESS_KEY")),
    })
    if (Option.isNone(config.bucket))
      return Service.of({ current: Effect.succeedNone, downloads: () => Effect.succeed([]), host: Option.none() })
    const bucket = config.bucket.value
    const s3 = new S3Client({
      region: config.region,
      forcePathStyle: Option.isSome(config.endpoint),
      ...(Option.isSome(config.endpoint) && { endpoint: config.endpoint.value }),
      ...(Option.isSome(config.accessKeyId) &&
        Option.isSome(config.secretAccessKey) && {
          credentials: {
            accessKeyId: config.accessKeyId.value,
            secretAccessKey: Redacted.value(config.secretAccessKey.value),
          },
        }),
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => s3.destroy()))
    const linkOf = (key: string) =>
      Effect.promise(() =>
        getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: `${folder}${key}` }), {
          expiresIn: Duration.toSeconds(linkLifetime),
        }),
      )
    return Service.of({
      // oxlint-disable-next-line ren/no-comments -- No manifest yet means no deploy has published bundles. A manifest Ren cannot read is a broken deploy: the machine's start fails and is reported.
      current: Effect.tryPromise({
        try: () =>
          s3
            .send(new GetObjectCommand({ Bucket: bucket, Key: `${folder}${Bundle.manifestKey}` }))
            .then((object) => object.Body?.transformToString() ?? ""),
        catch: (cause) => cause,
      }).pipe(
        Effect.map(Option.some),
        Effect.catchIf(
          (cause) => cause instanceof NoSuchKey,
          () => Effect.succeed(Option.none<string>()),
        ),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(Option.none<ReadonlyArray<Bundle.Info>>()),
            onSome: (text) =>
              Effect.map(Schema.decodeUnknownEffect(Schema.fromJsonString(Bundle.Manifest))(text), (manifest) =>
                Option.some(manifest.bundles),
              ),
          }),
        ),
        Effect.orDie,
        Effect.withSpan("Bundles.current"),
      ),
      downloads: Effect.fn("Bundles.downloads")(function* (bundles: ReadonlyArray<Bundle.Info>) {
        return yield* Effect.forEach(bundles, (bundle) =>
          Effect.map(linkOf(Bundle.keyOf(bundle)), (url) => ({
            kind: bundle.kind,
            version: bundle.version,
            sha256: bundle.sha256,
            url,
            tree: Bundle.treeOf(bundles, bundle.kind),
          })),
        )
      }),
      host: Option.some(new URL(yield* linkOf(Bundle.manifestKey)).hostname),
    })
  }),
)
