export * as Signature from "./signature.js"

import { Clock, Effect, Option, Schema } from "effect"
import { decodeProtectedHeader, type JWTPayload, jwtVerify, SignJWT } from "jose"

const keyAlgorithm = "Ed25519"
const tokenAlgorithm = "EdDSA"
const publicKeyBytes = 32
const privateKeyBytes = 48

const bytes = (length: number) =>
  Schema.Uint8ArrayFromBase64Url.check(
    Schema.makeFilter((value) => value.length === length || `${length} bytes in base64url`),
  )

export interface PublicKey extends Schema.Schema.Type<typeof PublicKey> {}
export const PublicKey = Schema.Struct({
  id: Schema.NonEmptyString,
  key: bytes(publicKeyBytes),
}).annotate({ identifier: "Signature.PublicKey" })

export interface PrivateKey extends Schema.Schema.Type<typeof PrivateKey> {}
export const PrivateKey = Schema.Struct({
  id: Schema.NonEmptyString,
  key: bytes(privateKeyBytes),
}).annotate({ identifier: "Signature.PrivateKey" })

export const PublicKeys = Schema.fromJsonString(
  Schema.NonEmptyArray(PublicKey).check(
    Schema.makeFilter((keys) => new Set(keys.map((key) => key.id)).size === keys.length || "key ids must be unique"),
  ),
).annotate({ identifier: "Signature.PublicKeys" })

export const SigningKey = Schema.fromJsonString(PrivateKey).annotate({ identifier: "Signature.SigningKey" })

export const generate = Effect.fn("Signature.generate")(function* (id: string) {
  const pair = yield* Effect.promise(() => crypto.subtle.generateKey(keyAlgorithm, true, ["sign", "verify"]))
  if (!("publicKey" in pair)) return yield* Effect.die(new Error("Ed25519 generated one key, not a key pair"))
  const publicKey = yield* Effect.promise(() => crypto.subtle.exportKey("raw", pair.publicKey))
  const privateKey = yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", pair.privateKey))
  return {
    publicKey: { id, key: new Uint8Array(publicKey) } satisfies PublicKey,
    privateKey: { id, key: new Uint8Array(privateKey) } satisfies PrivateKey,
  }
})

export const sign = Effect.fnUntraced(function* (key: PrivateKey, claims: JWTPayload) {
  const subtle = yield* Effect.promise(() =>
    crypto.subtle.importKey("pkcs8", new Uint8Array(key.key), keyAlgorithm, false, ["sign"]),
  )
  return yield* Effect.promise(() =>
    new SignJWT(claims).setProtectedHeader({ alg: tokenAlgorithm, kid: key.id }).sign(subtle),
  )
})

export const verify = Effect.fn("Signature.verify")(function* <
  C extends { readonly kid: string; readonly exp: number },
>(keys: ReadonlyArray<PublicKey>, claims: Schema.Decoder<C>, token: string): Effect.fn.Return<Option.Option<C>> {
  const header = yield* Effect.option(Effect.try(() => decodeProtectedHeader(token)))
  if (Option.isNone(header)) return Option.none()
  const key = keys.find((candidate) => candidate.id === header.value.kid)
  if (!key) return Option.none()
  const subtle = yield* Effect.promise(() =>
    crypto.subtle.importKey("raw", new Uint8Array(key.key), keyAlgorithm, false, ["verify"]),
  )
  const now = yield* Clock.currentTimeMillis
  const verified = yield* Effect.option(
    Effect.tryPromise(() =>
      jwtVerify(token, subtle, { algorithms: [tokenAlgorithm], requiredClaims: ["exp"], currentDate: new Date(now) }),
    ),
  )
  return verified.pipe(
    Option.flatMap((result) =>
      Schema.decodeUnknownOption(claims)({ ...result.payload, kid: result.protectedHeader.kid }),
    ),
  )
})
