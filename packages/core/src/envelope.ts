export * as Envelope from "./envelope.js"

import type { Envelope } from "@ren/schema/envelope"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

export { Context, Sealed } from "@ren/schema/envelope"

type Sealed = Envelope.Sealed

export class Unavailable extends Schema.TaggedError<Unavailable>()("Envelope.Unavailable", {
  message: Schema.String,
}) {}

export class Tampered extends Schema.TaggedError<Tampered>()("Envelope.Tampered", { message: Schema.String }) {}

export interface Interface {
  readonly seal: (value: Redacted.Redacted, context: Envelope.Context) => Effect.Effect<Sealed, Unavailable>
  readonly open: (sealed: Sealed, context: Envelope.Context) => Effect.Effect<Redacted.Redacted, Unavailable | Tampered>
  readonly rewrap: (sealed: Sealed, context: Envelope.Context) => Effect.Effect<Sealed, Unavailable | Tampered>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Envelope") {}

const MasterKeys = Schema.fromJsonString(
  Schema.NonEmptyArray(
    Schema.Struct({
      id: Schema.String.check(Schema.isStartingWith("local:")),
      key: Schema.Uint8ArrayFromBase64Url.check(
        Schema.makeFilter((key) => key.length === 32 || "32 bytes in base64url"),
      ),
    }),
  ),
)

const algorithm = "AES-GCM"

const base64 = Schema.encodeSync(Schema.Uint8ArrayFromBase64)
const fromBase64 = Schema.decodeUnknownOption(Schema.Uint8ArrayFromBase64)

const additionalData = (context: Envelope.Context) =>
  new TextEncoder().encode(JSON.stringify([context.organizationId, context.kind, context.id]))

const importKey = (raw: Uint8Array) =>
  Effect.promise(() => crypto.subtle.importKey("raw", new Uint8Array(raw), algorithm, false, ["encrypt", "decrypt"]))

const encrypt = (key: CryptoKey, plain: Uint8Array, data: Uint8Array) =>
  Effect.gen(function* () {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const cipher = yield* Effect.promise(() =>
      crypto.subtle.encrypt({ name: algorithm, iv, additionalData: new Uint8Array(data) }, key, new Uint8Array(plain)),
    )
    return { iv, cipher: new Uint8Array(cipher) }
  })

const decrypt = (key: CryptoKey, iv: Uint8Array, cipher: Uint8Array, data: Uint8Array) =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.decrypt(
        { name: algorithm, iv: new Uint8Array(iv), additionalData: new Uint8Array(data) },
        key,
        new Uint8Array(cipher),
      ),
    catch: () => new Tampered({ message: "The sealed value does not match its context or key." }),
  }).pipe(Effect.map((plain) => new Uint8Array(plain)))

const decode = (field: string) =>
  fromBase64(field).pipe(
    Effect.fromOption,
    Effect.mapError(() => new Tampered({ message: "The sealed value is not base64." })),
  )

// oxlint-disable-next-line ren/no-comments -- Each value gets a random data key (AES-256-GCM, the context as additional data); the newest master key wraps the data key, bound to the same context. The master key id stays on the row, so older keys still open it (§6.8).
export const layerLocal = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configured = yield* Config.option(Config.schema(Schema.RedactedFromValue(MasterKeys), "ENVELOPE_KEYS")).pipe(
      Effect.map(Option.map(Redacted.value)),
    )
    const keys = Option.getOrElse(configured, () => [])
    const masters = new Map(
      yield* Effect.forEach(keys, (master) => Effect.map(importKey(master.key), (key) => [master.id, key] as const)),
    )
    const newest = keys.at(0)?.id ?? "local:none"

    const seal = Effect.fn("Envelope.seal")(function* (value: Redacted.Redacted, context: Envelope.Context) {
      const master = masters.get(newest)
      if (!master) return yield* new Unavailable({ message: "ENVELOPE_KEYS has no key." })
      const data = additionalData(context)
      const dataKey = crypto.getRandomValues(new Uint8Array(32))
      const wrapped = yield* encrypt(master, dataKey, data)
      const sealed = yield* encrypt(yield* importKey(dataKey), new TextEncoder().encode(Redacted.value(value)), data)
      return {
        v: 1 as const,
        keyId: newest,
        wrappedKey: base64(new Uint8Array([...wrapped.iv, ...wrapped.cipher])),
        iv: base64(sealed.iv),
        ciphertext: base64(sealed.cipher),
      }
    })

    const open = Effect.fn("Envelope.open")(function* (sealed: Sealed, context: Envelope.Context) {
      const master = masters.get(sealed.keyId)
      if (!master) return yield* new Unavailable({ message: `Envelope key ${sealed.keyId} is not loaded.` })
      const data = additionalData(context)
      const wrapped = yield* decode(sealed.wrappedKey)
      const dataKey = yield* decrypt(master, wrapped.slice(0, 12), wrapped.slice(12), data)
      const plain = yield* decrypt(
        yield* importKey(dataKey),
        yield* decode(sealed.iv),
        yield* decode(sealed.ciphertext),
        data,
      )
      return Redacted.make(new TextDecoder().decode(plain))
    })

    return Service.of({
      seal,
      open,
      rewrap: Effect.fn("Envelope.rewrap")(function* (sealed: Sealed, context: Envelope.Context) {
        return sealed.keyId === newest ? sealed : yield* seal(yield* open(sealed, context), context)
      }),
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- During a move of master keys, rows of both key sets open; every seal and rewrap uses the target (§6.8, `envelope-rewrap` run).
export const layerMove = <E1, R1, E2, R2>(from: Layer.Layer<Service, E1, R1>, to: Layer.Layer<Service, E2, R2>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const source = yield* Service.pipe(Effect.provide(from))
      const target = yield* Service.pipe(Effect.provide(to))
      const open = (sealed: Sealed, context: Envelope.Context) =>
        target.open(sealed, context).pipe(Effect.catchTag("Envelope.Unavailable", () => source.open(sealed, context)))
      return Service.of({
        seal: target.seal,
        open,
        rewrap: Effect.fn("Envelope.rewrap")(function* (sealed: Sealed, context: Envelope.Context) {
          return yield* target.seal(yield* open(sealed, context), context)
        }),
      })
    }),
  )
