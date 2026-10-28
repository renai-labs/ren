import { describe, expect } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Seed, testEffect } from "@ren/core/testing"
import { Usage } from "@ren/core/usage"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { DateTime, Effect, Layer, Redacted } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { Routes } from "../src/routes.js"
import { environment, services } from "./lib/app.js"

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

describe("usage ingest", () => {
  it.live("a usage key sends only the events of its own producer", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const sessionId = yield* Seed.session(owner)
      const key = yield* Usage.issueKey("ren-inference")
      const http = yield* HttpClient.HttpClient
      const time = DateTime.formatIso(yield* DateTime.now)
      const send = (secret: string, source: string) =>
        http
          .execute(
            HttpClientRequest.post("/usage/v1/events").pipe(
              HttpClientRequest.bearerToken(secret),
              HttpClientRequest.bodyText(
                JSON.stringify({
                  events: [
                    {
                      source,
                      id: "chatcmpl-1:anthropic-sonnet-1",
                      type: "model.call",
                      time,
                      workload: `brain:${Brain.ofSession(sessionId)}`,
                      requested_model: "claude-sonnet-4-5",
                      payer: "ren",
                      provider: "anthropic",
                      served_model: "anthropic/claude-sonnet-4-5",
                    },
                  ],
                }),
                "application/json",
              ),
            ),
          )
          .pipe(Effect.flatMap((response) => Effect.map(response.json, (body) => [response.status, body] as const)))
      expect([
        yield* send(Redacted.value(key.secret), "litellm"),
        yield* send("ren_usage_unknown", "ren-inference"),
        yield* send(Redacted.value(key.secret), "ren-inference"),
      ]).toMatchObject([
        [403, { _tag: "ForbiddenError" }],
        [401, { _tag: "UnauthorizedError" }],
        [200, { inserted: 1 }],
      ])
    }),
  )
})
