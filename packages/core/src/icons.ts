export * as Icons from "./icons.js"

import { GetObjectCommand, PutObjectCommand, S3ServiceException } from "@aws-sdk/client-s3"
import { Context, Effect, Layer, Option, Schema } from "effect"
import sharp from "sharp"
import { ResourceIcon } from "@ren/schema/resource-icon"
import { ObjectStorage } from "./object-storage.js"

export class Invalid extends Schema.TaggedError<Invalid>()("Icons.Invalid", { message: Schema.String }) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Icons.Unavailable", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly store: (source: Uint8Array) => Effect.Effect<string, Invalid | Unavailable>
  readonly read: (hash: string) => Effect.Effect<Option.Option<Uint8Array>, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Icons") {}

export const side = 256

export const type = "image/webp"

const formats: ReadonlySet<string> = new Set(ResourceIcon.uploadFormats)

const maximumPixels = 4096 * 4096

const hashPattern = /^[a-f0-9]{64}$/u

const tooLarge = new Invalid({ message: ResourceIcon.uploadTooLarge })

const unreadable = new Invalid({ message: ResourceIcon.uploadUnreadable })

const keyOf = (hash: string) => `icons/${hash}.webp`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* ObjectStorage.Service
    const send = <A>(run: (signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({ try: run, catch: (cause) => new Unavailable({ cause }) })

    return Service.of({
      store: Effect.fn("Icons.store")(function* (source: Uint8Array) {
        if (source.byteLength > ResourceIcon.maximumUploadBytes) return yield* tooLarge
        const image = sharp(source, { limitInputPixels: maximumPixels })
        const metadata = yield* Effect.tryPromise({ try: () => image.metadata(), catch: () => unreadable })
        if (!formats.has(metadata.format)) return yield* unreadable
        const bytes = yield* Effect.tryPromise({
          try: () =>
            image.rotate().resize(side, side, { fit: "cover", position: "centre" }).webp({ quality: 90 }).toBuffer(),
          catch: () => unreadable,
        })
        const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
        yield* send((signal) =>
          storage.s3.send(
            new PutObjectCommand({ Bucket: storage.bucket, Key: keyOf(hash), Body: bytes, ContentType: type }),
            { abortSignal: signal },
          ),
        )
        return hash
      }),
      read: Effect.fn("Icons.read")(function* (hash: string) {
        if (!hashPattern.test(hash)) return Option.none()
        const object = yield* send((signal) =>
          storage.s3.send(new GetObjectCommand({ Bucket: storage.bucket, Key: keyOf(hash) }), { abortSignal: signal }),
        ).pipe(
          Effect.catchIf(
            (error) => error.cause instanceof S3ServiceException && error.cause.$metadata.httpStatusCode === 404,
            () => Effect.succeed(undefined),
          ),
        )
        const body = object?.Body
        if (!body) return Option.none()
        return Option.some(yield* send(() => body.transformToByteArray()))
      }),
    })
  }),
).pipe(Layer.provide(ObjectStorage.layer))
