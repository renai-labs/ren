export * as BrainToken from "./brain-token.js"

import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import { Signature } from "@ren/schema/signature"
import { Array, Effect, Option, Result, Schema } from "effect"
import { Base64Url } from "effect/encoding"

export const ServerClaims = Schema.Struct({
  kid: Schema.NonEmptyString,
  scope: Schema.Literal("server"),
  brain: Brain.ID,
  gen: Schema.Int,
  exp: Schema.Int,
  ren: Schema.optionalKey(Schema.String).annotate({ description: "Ren’s current address; the brain calls Ren there." }),
}).annotate({ identifier: "BrainToken.ServerClaims" })
export type ServerClaims = typeof ServerClaims.Type

export const ClientClaims = Schema.Struct({
  kid: Schema.NonEmptyString,
  scope: Schema.Literal("client"),
  brain: Brain.ID,
  gen: Schema.Int,
  sid: Session.ID,
  sub: Schema.String,
  member: Schema.optionalKey(Auth.MemberID),
  name: Schema.optionalKey(Schema.String),
  exp: Schema.Int,
}).annotate({ identifier: "BrainToken.ClientClaims" })
export type ClientClaims = typeof ClientClaims.Type

export const HostClaims = Schema.Struct({
  kid: Schema.NonEmptyString,
  scope: Schema.Literal("host"),
  brain: Brain.ID,
  gen: Schema.Int,
  org: Auth.OrganizationID,
  iat: Schema.Int,
  exp: Schema.Int,
}).annotate({ identifier: "BrainToken.HostClaims" })
export type HostClaims = typeof HostClaims.Type

export const Claims = Schema.Union([ServerClaims, ClientClaims, HostClaims]).annotate({
  identifier: "BrainToken.Claims",
})
export type Claims = typeof Claims.Type

type Unsigned<C> = C extends Claims ? Omit<C, "kid"> : never

export const toleranceSeconds = 60

export const lifetimes = { server: 5 * 60, client: 60 * 60, host: 2 * 60 * 60 } as const

export const sign = (key: Signature.PrivateKey, claims: Unsigned<Claims>) => Signature.sign(key, claims)

export const verify = (keys: ReadonlyArray<Signature.PublicKey>, token: string) =>
  Signature.verify(keys, Claims, token, { toleranceSeconds })

const Expiry = Schema.fromJsonString(Schema.Struct({ exp: Schema.Int }))

export const expiry = (token: string) =>
  Option.fromNullishOr(token.split(".").at(1)).pipe(
    Option.flatMap((part) => Result.getSuccess(Base64Url.decodeString(part))),
    Option.flatMap(Schema.decodeUnknownOption(Expiry)),
    Option.map((claims) => claims.exp),
  )

export const keyIdOf = (token: string) =>
  Option.fromNullishOr(token.split(".").at(0)).pipe(
    Option.flatMap((part) => Result.getSuccess(Base64Url.decodeString(part))),
    Option.flatMap(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ kid: Schema.String })))),
    Option.map((header) => header.kid),
  )

export const publicKeys = Effect.fn("BrainToken.publicKeys")(function* (
  keys: Array.NonEmptyReadonlyArray<Signature.PrivateKey>,
) {
  const first = yield* Signature.publicKeyOf(Array.headNonEmpty(keys))
  const rest = yield* Effect.forEach(Array.tailNonEmpty(keys), Signature.publicKeyOf)
  const all: Array.NonEmptyReadonlyArray<Signature.PublicKey> = [first, ...rest]
  return all
})
