import { describe, expect } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { SessionToken } from "@ren/brain-api/session-token"
import { maxBodyBytes } from "@ren/brain-api/sync-api"
import { Seed, Sync, testEffect } from "@ren/core/testing"
import { Testing } from "@ren/db/testing"
import { Clock, Effect, Layer, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter } from "effect/http"
import { Routes } from "../src/routes.js"
import { cellKey, config, environment, services } from "./lib/app.js"

const it = testEffect(
  HttpRouter.serve(Routes.layer, {
    disableListenLog: true,
    disableLogger: true,
  }).pipe(
    Layer.provide(services),
    Layer.provide(FetchHttpClient.layer),
    Layer.provideMerge(BunHttpServer.layerTest),
    Layer.provideMerge(Testing.layer),
    Layer.provide(environment()),
  ),
)

const post = (path: string, headers: Record<string, string>) =>
  HttpClientRequest.post(path).pipe(HttpClientRequest.setHeaders(headers))

const json = (path: string, headers: Record<string, string>, body: unknown) =>
  post(path, headers).pipe(HttpClientRequest.bodyText(JSON.stringify(body), "application/json"))

describe("body limit", () => {
  it.live(
    "a body over 1 MiB gets 413 outside the SyncApi, the SyncApi takes it up to maxBodyBytes, and a body with no length gets 411",
    () =>
      Effect.gen(function* () {
        const owner = yield* Seed.owner()
        const sessionId = yield* Seed.session(owner)
        const host = {
          authorization: `Bearer ${yield* SessionToken.sign(cellKey, {
            sid: sessionId,
            scope: "host",
            org: owner.organizationId,
            iat: Math.floor((yield* Clock.currentTimeMillis) / 1000),
            exp: Math.floor((yield* Clock.currentTimeMillis) / 1000) + 600,
          })}`,
        }
        const http = yield* HttpClient.HttpClient
        const upload = yield* http
          .execute(
            json(`/brain/sync/sessions/${sessionId}/uploads`, host, {
              harness: "opencode",
              parentId: null,
            }),
          )
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ upload: Schema.Int }))))
        const messages = `/brain/sync/sessions/${sessionId}/uploads/${upload.upload}/messages`
        const batch = (bytes: number) =>
          json(messages, host, {
            messages: [
              Sync.message(sessionId, "msg_large", 2, {
                data: "x".repeat(bytes),
              }),
            ],
          })
        const large = "x".repeat(2 * 1024 * 1024)
        const statuses = yield* Effect.forEach(
          [
            json(
              "/auth/sign-up/email",
              { origin: config.BETTER_AUTH_URL },
              {
                email: "ada@gmail.com",
                password: "correct horse battery staple",
                name: large,
              },
            ),
            json("/brain/models/refresh", host, { large }),
            batch(large.length),
            batch(maxBodyBytes),
            post(messages, host).pipe(
              HttpClientRequest.bodyStream(Stream.make(new TextEncoder().encode(JSON.stringify({ messages: [] }))), {
                contentType: "application/json",
              }),
            ),
          ],
          (request) =>
            http.execute(request).pipe(
              Effect.tap((response) => response.text),
              Effect.map((response) => response.status),
            ),
        )
        expect(statuses).toEqual([413, 413, 204, 413, 411])
      }),
  )
})
