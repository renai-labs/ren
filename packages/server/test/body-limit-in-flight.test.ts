import { expect } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { testEffect } from "@ren/core/testing"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter, HttpServerResponse } from "effect/http"
import { bodyLimit } from "../src/middleware/body-limit.js"

const held = Deferred.makeUnsafe<void>()
const entered = Deferred.makeUnsafe<void>()

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
const routes = HttpRouter.use((router) =>
  router.add("POST", "/upload", (request) =>
    Effect.gen(function* () {
      yield* request.text
      if (request.headers["x-hold"]) {
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(held)
      }
      return HttpServerResponse.empty({ status: 204 })
    }),
  ),
)

const it = testEffect(
  HttpRouter.serve(routes.pipe(Layer.provide(bodyLimit(100, { inFlightBytes: 150 }))), {
    disableListenLog: true,
    disableLogger: true,
  }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provideMerge(BunHttpServer.layerTest)),
)

const upload = (bytes: number, headers: Record<string, string> = {}) =>
  Effect.flatMap(HttpClient.HttpClient, (http) =>
    http.execute(
      HttpClientRequest.post("/upload").pipe(
        HttpClientRequest.setHeaders(headers),
        HttpClientRequest.bodyText("x".repeat(bytes)),
      ),
    ),
  ).pipe(Effect.map((response) => response.status))

it.live("bodies over the in-flight bytes wait for none: they get 503 while others run, and pass once those end", () =>
  Effect.gen(function* () {
    const first = yield* upload(100, { "x-hold": "1" }).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const meanwhile = [yield* upload(100), yield* upload(50)]
    yield* Deferred.succeed(held, undefined)
    expect([meanwhile, yield* Fiber.join(first), yield* upload(100)]).toEqual([[503, 204], 204, 204])
  }),
)
