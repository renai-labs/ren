import { describe, expect } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { ForbiddenError, StaleUploadError } from "@ren/host-api/errors"
import { SessionToken } from "@ren/host-api/session-token"
import { SyncApi } from "@ren/host-api/sync-api"
import { Seed, SyncFixture, testEffect } from "@ren/core/testing"
import { Testing } from "@ren/db/testing"
import { Clock, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { Routes } from "../src/routes.js"
import { cellKey, environment, services } from "./lib/app.js"

const it = testEffect(
  HttpRouter.serve(Routes.layer, { disableListenLog: true, disableLogger: true }).pipe(
    Layer.provide(services),
    Layer.provide(FetchHttpClient.layer),
    Layer.provideMerge(BunHttpServer.layerTest),
    Layer.provideMerge(Testing.layer),
    Layer.provide(environment()),
  ),
)

const expiry = Clock.currentTimeMillis.pipe(Effect.map((now) => Math.floor(now / 1000) + 600))

const root = Effect.fnUntraced(function* () {
  const owner = yield* Seed.owner()
  const rootId = yield* Seed.session(owner)
  const hostToken = yield* SessionToken.sign(cellKey, {
    sid: rootId,
    scope: "host",
    org: owner.organizationId,
    iat: Math.floor((yield* Clock.currentTimeMillis) / 1000),
    exp: yield* expiry,
  })
  return { owner, rootId, client: yield* client(hostToken) }
})

const client = (bearer: string) =>
  HttpApiClient.make(SyncApi, { transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(bearer)) })

describe("SyncApi", () => {
  it.live("a host uploads a pass and reads it back for a restore", () =>
    Effect.gen(function* () {
      const host = yield* root()
      const sync = host.client.sync
      const params = { id: host.rootId }
      const row = SyncFixture.session(host.rootId, { title: "Fix the build", time_suspended: SyncFixture.now })
      const messages = [
        SyncFixture.message(host.rootId, "msg_a", 2, { data: JSON.stringify({ text: "tool output with \u0000" }) }),
        SyncFixture.message(host.rootId, "msg_b", 2 ** 40),
        SyncFixture.message(host.rootId, "msg_c", 2 ** 40),
      ]
      const opened = yield* sync["sync.startUpload"]({ params, payload: { harness: "opencode", parentId: null } })
      const upload = { ...params, upload: opened.upload }
      yield* sync["sync.uploadMessages"]({ params: upload, payload: { messages } })
      yield* sync["sync.commit"]({
        params: upload,
        payload: { session: row, seq: 2 ** 40, ids: messages.map((message) => message.id) },
      })
      expect(yield* sync["sync.checkpoints"]()).toEqual({
        sessions: [{ id: host.rootId, syncSeq: 2 ** 40, timeSuspended: SyncFixture.now }],
      })
      expect(yield* sync["sync.restore"]({ payload: { sessionId: host.rootId } })).toEqual({ sessions: [row] })
      const first = yield* sync["sync.messages"]({ params, query: { limit: 2 } })
      expect(first).toEqual({ messages: messages.slice(0, 2), next: { seq: 2 ** 40, id: "msg_b" } })
      expect(
        yield* sync["sync.messages"]({
          params,
          query: { afterSeq: 2 ** 40, afterId: "msg_b", limit: 2 },
        }),
      ).toEqual({ messages: messages.slice(2), next: null })
    }),
  )

  it.live("the scope comes from the host token, so a host cannot read or write another root", () =>
    Effect.gen(function* () {
      const host = yield* root()
      const other = yield* Seed.session(host.owner)
      const sync = host.client.sync
      const attempts: ReadonlyArray<Effect.Effect<unknown, unknown, HttpClient.HttpClient>> = [
        sync["sync.startUpload"]({ params: { id: other }, payload: { harness: "opencode", parentId: null } }),
        sync["sync.restore"]({ payload: { sessionId: other } }),
        sync["sync.messages"]({ params: { id: other }, query: { limit: 10 } }),
        Effect.flatMap(
          client(yield* SessionToken.sign(cellKey, { sid: host.rootId, scope: "server", exp: yield* expiry })),
          (server) => server.sync["sync.checkpoints"](),
        ),
      ]
      for (const attempt of attempts) expect(yield* Effect.flip(attempt)).toBeInstanceOf(ForbiddenError)
      expect((yield* sync["sync.checkpoints"]()).sessions.map((session) => session.id)).toEqual([host.rootId])
    }),
  )

  it.live("a batch of an old upload gets StaleUploadError, and the client decodes it", () =>
    Effect.gen(function* () {
      const host = yield* root()
      const sync = host.client.sync
      const params = { id: host.rootId }
      const old = yield* sync["sync.startUpload"]({ params, payload: { harness: "opencode", parentId: null } })
      yield* sync["sync.startUpload"]({ params, payload: { harness: "opencode", parentId: null } })
      expect(
        yield* Effect.flip(
          sync["sync.uploadMessages"]({
            params: { ...params, upload: old.upload },
            payload: { messages: [SyncFixture.message(host.rootId, "msg_late", 2)] },
          }),
        ),
      ).toBeInstanceOf(StaleUploadError)
    }),
  )
})
