export * as SessionToken from "./session-token.js"

import { Session } from "@ren/schema/session"
import { Clock, Effect, Schema } from "effect"
import { Base64Url } from "effect/encoding"

export class InvalidToken extends Schema.TaggedError<InvalidToken>()("SessionToken.InvalidToken", {}) {}

export const Scope = Schema.Literals(["server", "client"]).annotate({ identifier: "SessionToken.Scope" })
export type Scope = typeof Scope.Type

export interface Claims extends Schema.Schema.Type<typeof Claims> {}
export const Claims = Schema.Struct({
  kid: Schema.NonEmptyString,
  sid: Session.ID,
  scope: Scope,
  exp: Schema.Int,
}).annotate({ identifier: "SessionToken.Claims" })

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const Key = Schema.Struct({
  id: Schema.NonEmptyString,
  secret: Schema.String.check(Schema.isMinLength(32)),
}).annotate({ identifier: "SessionToken.Key" })

export const Keys = Schema.fromJsonString(
  Schema.NonEmptyArray(Key).check(
    Schema.makeFilter((keys) => new Set(keys.map((key) => key.id)).size === keys.length || "key ids must be unique"),
  ),
).annotate({ identifier: "SessionToken.Keys" })

const encoder = new TextEncoder()

const hmac = (secret: string, usage: "sign" | "verify") =>
  Effect.promise(() =>
    crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]),
  )

export const seal = Effect.fnUntraced(function* (secret: string, payload: unknown) {
  const signed = Base64Url.encode(JSON.stringify(payload))
  const key = yield* hmac(secret, "sign")
  const signature = yield* Effect.promise(() => crypto.subtle.sign("HMAC", key, encoder.encode(signed)))
  return `${signed}.${Base64Url.encode(new Uint8Array(signature))}`
})

export const sign = (key: Key, claims: Omit<Claims, "kid">) => seal(key.secret, { kid: key.id, ...claims })

export const verify = Effect.fn("SessionToken.verify")(
  function* (keys: ReadonlyArray<Key>, token: string) {
    if (!/^[\w-]+\.[\w-]+$/.test(token)) return yield* new InvalidToken()
    const signed = token.slice(0, token.indexOf("."))
    const signature = yield* Effect.fromResult(Base64Url.decode(token.slice(signed.length + 1)))
    const claims = yield* Effect.fromResult(Base64Url.decodeString(signed)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Claims))),
    )
    const key = keys.find((candidate) => candidate.id === claims.kid)
    if (!key) return yield* new InvalidToken()
    const subtle = yield* hmac(key.secret, "verify")
    const valid = yield* Effect.promise(() =>
      crypto.subtle.verify("HMAC", subtle, new Uint8Array(signature), encoder.encode(signed)),
    )
    if (!valid || (yield* Clock.currentTimeMillis) >= claims.exp * 1000) return yield* new InvalidToken()
    return claims
  },
  Effect.mapError(() => new InvalidToken()),
)
