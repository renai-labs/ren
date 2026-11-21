export * as TestServer from "./server.js"

import { HandClient } from "@ren/hand-api/hand-client"
import { Brain } from "@ren/schema/brain"
import { Hand } from "@ren/schema/hand"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TestHand } from "./test-hand.js"

export const environmentId = Hand.ID.create()
export const brain = Brain.ID.create()
export const workspace = await mkdtemp(join(tmpdir(), "ren-executor-"))
export const layer = TestHand.layer({ environmentId, workspace, generation: 1 }).pipe(
  Layer.provideMerge(FetchHttpClient.layer),
)

export const token = Effect.fnUntraced(function* (
  claims: { readonly environmentId?: Hand.ID; readonly brain?: Brain.ID; readonly generation?: number } = {},
) {
  return Redacted.value(
    (yield* TestHand.access({
      url: yield* TestHand.url,
      environmentId,
      brain,
      directory: workspace,
      ...claims,
    })).token,
  )
})

export const connect = Effect.fnUntraced(function* (bearer: string) {
  return yield* HandClient.make({ url: new URL(yield* TestHand.url), token: Effect.succeed(bearer) })
})

export const client = Effect.fnUntraced(function* (claims: { readonly brain?: Brain.ID } = {}) {
  return yield* connect(yield* token(claims))
})

export const rpc = (tag: string, payload: object | null) =>
  `${JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] })}\n`

export const post = Effect.fnUntraced(function* (body: string | Uint8Array, authorization?: string) {
  const http = yield* HttpClient.HttpClient
  const request = HttpClientRequest.post(`${yield* TestHand.url}${HandClient.path}`).pipe(
    typeof body === "string"
      ? HttpClientRequest.bodyText(body, "application/ndjson")
      : HttpClientRequest.bodyUint8Array(body, "application/ndjson"),
    (built) =>
      authorization === undefined ? built : HttpClientRequest.setHeader(built, "authorization", authorization),
  )
  const response = yield* http.execute(request)
  return { status: response.status, body: yield* response.text }
})
