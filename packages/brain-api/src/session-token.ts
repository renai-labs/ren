export * as SessionToken from "./session-token.js"

import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Clock, Effect, Option, Result, Schema } from "effect"
import { Base64Url } from "effect/encoding"

export const Claims = Schema.Union([
  Schema.Struct({
    kid: Schema.NonEmptyString,
    sid: Session.ID,
    scope: Schema.Literals(["server", "client"]),
    sub: Schema.optionalKey(Schema.String),
    exp: Schema.Int,
  }),
  Schema.Struct({
    kid: Schema.NonEmptyString,
    sid: Session.ID,
    scope: Schema.Literal("host"),
    org: Auth.OrganizationID,
    iat: Schema.Int,
    exp: Schema.Int,
  }),
]).annotate({ identifier: "SessionToken.Claims" })
export type Claims = typeof Claims.Type

type Unsigned<C> = C extends Claims ? Omit<C, "kid"> : never

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

export const sign = (key: Key, claims: Unsigned<Claims>) => seal(key.secret, { kid: key.id, ...claims })

export const verify = Effect.fn("SessionToken.verify")(function* (
  keys: ReadonlyArray<Key>,
  token: string,
): Effect.fn.Return<Option.Option<Claims>> {
  const parts = /^([\w-]+)\.([\w-]+)$/.exec(token)
  const head = parts?.at(1)
  const signature = Option.fromNullishOr(parts?.at(2)).pipe(
    Option.flatMap((part) => Result.getSuccess(Base64Url.decode(part))),
  )
  const claims = Option.fromNullishOr(head).pipe(
    Option.flatMap((part) => Result.getSuccess(Base64Url.decodeString(part))),
    Option.flatMap(Schema.decodeUnknownOption(Schema.fromJsonString(Claims))),
  )
  if (!head || Option.isNone(signature) || Option.isNone(claims)) return Option.none()
  const key = keys.find((candidate) => candidate.id === claims.value.kid)
  if (!key) return Option.none()
  const subtle = yield* hmac(key.secret, "verify")
  const isSigned = yield* Effect.promise(() =>
    crypto.subtle.verify("HMAC", subtle, new Uint8Array(signature.value), encoder.encode(head)),
  )
  const now = yield* Clock.currentTimeMillis
  return isSigned && now < claims.value.exp * 1000 ? claims : Option.none()
})
