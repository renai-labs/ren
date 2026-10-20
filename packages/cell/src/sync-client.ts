export * as SyncClient from "./sync-client.js"

import { OpenCodeSync } from "@ren/brain/opencode-sync"
import { SyncApi } from "@ren/host-api/sync-api"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"

const remoteError = (error: { readonly message: string }) => new OpenCodeSync.RemoteError({ message: error.message })

export const make = Effect.fn("SyncClient.make")(function* (url: string, token: Effect.Effect<string>) {
  const http = yield* HttpClient.HttpClient
  const client = yield* HttpApiClient.makeWith(SyncApi, {
    baseUrl: url,
    httpClient: HttpClient.mapRequestEffect(http, (request) =>
      Effect.map(token, (value) => HttpClientRequest.bearerToken(request, value)),
    ),
  })
  const sync = client.sync
  return {
    checkpoints: sync["sync.checkpoints"]().pipe(
      Effect.map((body) => body.sessions),
      Effect.mapError(remoteError),
    ),
    startUpload: (id, parentId) =>
      sync["sync.startUpload"]({ params: { id }, payload: { harness: "opencode", parentId } }).pipe(
        Effect.map((body) => body.upload),
        Effect.catchTag("ForbiddenError", (error) => Effect.fail(new OpenCodeSync.Refused({ message: error.message }))),
        Effect.mapError((error) => (error._tag === "OpenCodeSync.Refused" ? error : remoteError(error))),
      ),
    uploadMessages: (upload, messages) =>
      sync["sync.uploadMessages"]({ params: upload, payload: { messages } }).pipe(Effect.mapError(remoteError)),
    commit: (upload, input) =>
      sync["sync.commit"]({ params: upload, payload: input }).pipe(Effect.mapError(remoteError)),
    restore: (sessionId) =>
      sync["sync.restore"]({ payload: { sessionId } }).pipe(
        Effect.map((body) => body.sessions),
        Effect.mapError(remoteError),
      ),
    messages: (id, after, limit) =>
      sync["sync.messages"]({
        params: { id },
        query: { limit, ...(after && { afterSeq: after.seq, afterId: after.id }) },
      }).pipe(Effect.mapError(remoteError)),
  } satisfies OpenCodeSync.Remote
})
