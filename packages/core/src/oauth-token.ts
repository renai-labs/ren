export * as OAuthToken from "./oauth-token.js"

import { Effect, Option, Redacted, Result, Schema } from "effect"
import type { OAuthFetch } from "./oauth-fetch.js"

export const TokenEndpointAuth = Schema.Literals(["none", "client_secret_basic", "client_secret_post"])

export const Client = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.RedactedFromValue(Schema.String)),
  tokenEndpointAuth: TokenEndpointAuth,
})
export type Client = typeof Client.Type

const decodeClaims = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ sub: Schema.optional(Schema.String) })),
)

export const sha256 = (text: string, encoding: "hex" | "base64url") =>
  new Bun.CryptoHasher("sha256").update(text).digest(encoding)

// oxlint-disable-next-line ren/no-comments -- §8 rule 6 and §10c rule 4: only these codes with HTTP 400 or 401 are fatal.
export const refreshFatal: ReadonlyArray<string> = ["invalid_grant", "invalid_client", "bad_refresh_token"]

export const clientCredentialsFatal: ReadonlyArray<string> = ["invalid_client", "unauthorized_client"]

export interface Token {
  readonly accessToken: string
  readonly refreshToken: Option.Option<string>
  readonly expiresIn: Option.Option<number>
  readonly scope: Option.Option<string>
  readonly subject: Option.Option<string>
}

export interface TokenError {
  readonly status: number
  readonly code: string
  readonly description: string
}

const Answer = Schema.Struct({
  access_token: Schema.optional(Schema.Unknown),
  token_type: Schema.optional(Schema.Unknown),
  expires_in: Schema.optional(Schema.Unknown),
  refresh_token: Schema.optional(Schema.Unknown),
  scope: Schema.optional(Schema.Unknown),
  id_token: Schema.optional(Schema.Unknown),
  user_id: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
  error_description: Schema.optional(Schema.Unknown),
})
const decodeAnswer = Schema.decodeUnknownOption(Answer)

const text = (value: unknown) => Option.liftPredicate(value, (found): found is string => typeof found === "string")

// oxlint-disable-next-line ren/no-comments -- §8 rule 6: the code is a string or `{ error: { code } }`; anything else is an unknown code, which is temporary (ren-v1 bug S15).
const errorCodeOf = (error: unknown) =>
  Option.orElse(text(error), () =>
    error && typeof error === "object" && "code" in error ? text(error.code) : Option.none(),
  )

// oxlint-disable-next-line ren/no-comments -- §7 rule 10: a number or a numeric string; zero, negative or anything else is missing.
const secondsOf = (raw: unknown) => {
  const seconds = typeof raw === "string" && /^\d+$/u.test(raw) ? Number(raw) : raw
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Option.some(seconds) : Option.none()
}

// oxlint-disable-next-line ren/no-comments -- K41: the account id is the ID token's `sub`, else a profile id in the answer. It is only compared, so the ID token is not verified.
const subjectOf = (answer: typeof Answer.Type) => {
  const payload = Option.flatMap(text(answer.id_token), (token) => Option.fromNullishOr(token.split(".").at(1)))
  const claims = Option.flatMap(payload, (part) => decodeClaims(Buffer.from(part, "base64url").toString()))
  return Option.orElse(
    Option.flatMap(claims, (found) => Option.fromNullishOr(found.sub)),
    () => text(answer.user_id),
  )
}

// oxlint-disable-next-line ren/no-comments -- §7 rule 10 (K5, K6): a refresh token is optional; a 2xx with `error` and no `access_token` is an error; `token_type` is Bearer in any case, or missing.
export const readToken = (status: number, body: unknown): Result.Result<Token, TokenError> => {
  const empty: typeof Answer.Type = {}
  const answer = Option.getOrElse(decodeAnswer(body), () => empty)
  const accessToken = text(answer.access_token)
  const ok = status >= 200 && status < 300
  if (!ok || Option.isNone(accessToken))
    return Result.fail({
      status,
      code: Option.getOrElse(errorCodeOf(answer.error), () => (ok ? "invalid_response" : "unknown")),
      description: Option.getOrElse(text(answer.error_description), () => ""),
    })
  const tokenType = text(answer.token_type)
  if (Option.isSome(tokenType) && tokenType.value.toLowerCase() !== "bearer")
    return Result.fail({ status, code: "unsupported_token_type", description: `token_type ${tokenType.value}` })
  return Result.succeed({
    accessToken: accessToken.value,
    refreshToken: text(answer.refresh_token),
    expiresIn: secondsOf(answer.expires_in),
    scope: text(answer.scope),
    subject: subjectOf(answer),
  })
}

export const isFatal = (error: TokenError, codes: ReadonlyArray<string>) =>
  (error.status === 400 || error.status === 401) && codes.includes(error.code)

// oxlint-disable-next-line ren/no-comments -- §7 rules 15 and 16, §8 rule 11: one token request for sign-in and refresh. Every request carries `client_id`; the secret goes only to this endpoint, in the way the client was registered.
export const post = (
  fetch: OAuthFetch.Fetch,
  endpoint: string,
  client: Client,
  form: Readonly<Record<string, string | undefined>>,
) =>
  Effect.tryPromise({
    try: async () => {
      const body = new URLSearchParams(
        Object.entries(form).flatMap(([key, value]): Array<[string, string]> => (value ? [[key, value]] : [])),
      )
      body.set("client_id", client.clientId)
      const secret = client.clientSecret && Redacted.value(client.clientSecret)
      const headers = new Headers({ "content-type": "application/x-www-form-urlencoded", accept: "application/json" })
      if (secret && client.tokenEndpointAuth === "client_secret_post") body.set("client_secret", secret)
      if (secret && client.tokenEndpointAuth === "client_secret_basic")
        headers.set(
          "authorization",
          `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(secret)}`).toString("base64")}`,
        )
      const response = await fetch(endpoint, { method: "POST", headers, body })
      const answer: unknown = await response.json().catch(() => null)
      return readToken(response.status, answer)
    },
    catch: (cause) => new Error(`The token endpoint did not answer: ${String(cause)}`),
  })

// oxlint-disable-next-line ren/no-comments -- §10c (RFC 6749 §4.4): an exchange of the stored client id and secret, at the stored token endpoint only.
export const exchangeClientCredentials = (
  fetch: OAuthFetch.Fetch,
  value: {
    readonly clientId: string
    readonly clientSecret: Redacted.Redacted
    readonly tokenEndpoint: string
    readonly tokenEndpointAuth: "client_secret_post" | "client_secret_basic"
    readonly scope?: string | undefined
  },
) =>
  post(
    fetch,
    value.tokenEndpoint,
    { clientId: value.clientId, clientSecret: value.clientSecret, tokenEndpointAuth: value.tokenEndpointAuth },
    { grant_type: "client_credentials", scope: value.scope },
  )
