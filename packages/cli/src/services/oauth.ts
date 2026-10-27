export * as OAuth from "./oauth.js"

import { Auth } from "@ren/schema/auth"
import { Array, Clock, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { Credentials } from "./credentials.js"

const ProtectedResource = Schema.Struct({
  resource: Schema.String,
  authorization_servers: Schema.NonEmptyArray(Schema.String),
})

const AuthorizationServer = Schema.Struct({
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  revocation_endpoint: Schema.optionalKey(Schema.String),
})

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
})

export const discover = Effect.fn("OAuth.discover")(function* (server: URL) {
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  const resource = yield* http
    .get(new URL("/.well-known/oauth-protected-resource", server))
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(ProtectedResource)))
  const issuer = new URL(Array.headNonEmpty(resource.authorization_servers))
  const metadata = yield* http
    .get(new URL(`/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/u, "")}`, issuer))
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthorizationServer)))
  return { ...metadata, resource: resource.resource }
})

export type Endpoints = Effect.Success<ReturnType<typeof discover>>

export const token = Effect.fn("OAuth.token")(function* (endpoints: Endpoints, params: Record<string, string>) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(
    HttpClientRequest.post(endpoints.token_endpoint).pipe(
      HttpClientRequest.bodyUrlParams({ ...params, client_id: Auth.cliClient.client_id, resource: endpoints.resource }),
    ),
  )
  if (response.status === 400 || response.status === 401)
    return yield* Effect.fail(new Error("Your session expired. Run ren2 login."))
  const issued = yield* HttpClientResponse.filterStatusOk(response).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)),
  )
  const credential: Credentials.Credential = {
    accessToken: issued.access_token,
    refreshToken: issued.refresh_token,
    expiresAt: (yield* Clock.currentTimeMillis) + issued.expires_in * 1000,
  }
  return credential
})

export const revoke = Effect.fn("OAuth.revoke")(function* (endpoints: Endpoints, credential: Credentials.Credential) {
  if (!endpoints.revocation_endpoint) return
  const http = yield* HttpClient.HttpClient
  yield* http.execute(
    HttpClientRequest.post(endpoints.revocation_endpoint).pipe(
      HttpClientRequest.bodyUrlParams({
        token: credential.refreshToken,
        token_type_hint: "refresh_token",
        client_id: Auth.cliClient.client_id,
      }),
    ),
  )
})
