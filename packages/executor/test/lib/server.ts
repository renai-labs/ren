export * as TestServer from "./server.js"

import { EnvironmentClient } from "@ren/environment-api/environment-client"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TestEnvironment } from "./test-environment.js"

export const environmentId = Environment.ID.create()
export const brain = Brain.ID.create()
export const workspace = await mkdtemp(join(tmpdir(), "ren-executor-"))
export const layer = TestEnvironment.layer({ environmentId, workspace }).pipe(Layer.provideMerge(FetchHttpClient.layer))

export const token = Effect.fnUntraced(function* (
  claims: { readonly environmentId?: Environment.ID; readonly brain?: Brain.ID } = {},
) {
  return Redacted.value(
    (yield* TestEnvironment.access({
      url: yield* TestEnvironment.url,
      environmentId,
      brain,
      directory: workspace,
      ...claims,
    })).token,
  )
})

export const connect = Effect.fnUntraced(function* (bearer: string) {
  return yield* EnvironmentClient.make({ url: new URL(yield* TestEnvironment.url), token: Effect.succeed(bearer) })
})

export const client = Effect.fnUntraced(function* (claims: { readonly brain?: Brain.ID } = {}) {
  return yield* connect(yield* token(claims))
})

export const rpc = (tag: string, payload: object | null) =>
  `${JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] })}\n`

export const post = Effect.fnUntraced(function* (body: string | Uint8Array, authorization?: string) {
  const http = yield* HttpClient.HttpClient
  const request = HttpClientRequest.post(`${yield* TestEnvironment.url}${EnvironmentClient.path}`).pipe(
    typeof body === "string"
      ? HttpClientRequest.bodyText(body, "application/ndjson")
      : HttpClientRequest.bodyUint8Array(body, "application/ndjson"),
    (built) =>
      authorization === undefined ? built : HttpClientRequest.setHeader(built, "authorization", authorization),
  )
  const response = yield* http.execute(request)
  return { status: response.status, body: yield* response.text }
})
