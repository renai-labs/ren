export * as Token from "./token.js"

import { CellToken } from "@ren/schema/cell-token"
import { Clock, Effect, Option, Result, Schema } from "effect"
import { Base64, Base64Url } from "effect/encoding"

class InvalidToken extends Schema.TaggedError<InvalidToken>()("Token.InvalidToken", {}) {}

const encoder = new TextEncoder()

export const read = (authorization: string | null) =>
  Option.fromNullishOr(/^Basic\s+(\S+)$/i.exec(authorization ?? "")?.at(1)).pipe(
    Option.flatMap((basic) => Result.getSuccess(Base64.decodeString(basic))),
    Option.flatMapNullishOr((credential) => /^[^:]*:(.+)$/s.exec(credential)?.at(1)),
  )

export const verify = Effect.fn("Token.verify")(
  function* (keys: ReadonlyArray<CellToken.Key>, token: string) {
    if (!/^[\w-]+\.[\w-]+$/.test(token)) return yield* new InvalidToken()
    const signed = token.slice(0, token.indexOf("."))
    const signature = yield* Effect.fromResult(Base64Url.decode(token.slice(signed.length + 1)))
    const payload = yield* Effect.fromResult(Base64Url.decodeString(signed)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(CellToken.Payload))),
    )
    const key = keys.find((candidate) => candidate.id === payload.kid)
    if (!key) return yield* new InvalidToken()
    const valid = yield* Effect.promise(async () =>
      crypto.subtle.verify(
        "HMAC",
        await crypto.subtle.importKey("raw", encoder.encode(key.secret), { name: "HMAC", hash: "SHA-256" }, false, [
          "verify",
        ]),
        signature,
        encoder.encode(signed),
      ),
    )
    if (!valid || (yield* Clock.currentTimeMillis) >= payload.exp * 1000) return yield* new InvalidToken()
    return payload
  },
  Effect.mapError(() => new InvalidToken()),
)
