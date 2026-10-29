import { describe, expect } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Seed, testEffect } from "@ren/core/testing"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { DateTime, Effect, Layer } from "effect"
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
    Layer.provide(environment(undefined, { USAGE_INGEST_KEY: "ren_usage_test" })),
  ),
)

describe("usage ingest", () => {
  it.live("only the usage ingest key can record events", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const sessionId = yield* Seed.session(owner)
      const http = yield* HttpClient.HttpClient
      const time = DateTime.formatIso(yield* DateTime.now)
      const send = (secret: string) =>
        http
          .execute(
            HttpClientRequest.post("/usage/v1/events").pipe(
              HttpClientRequest.bearerToken(secret),
              HttpClientRequest.bodyText(
                JSON.stringify({
                  events: [
                    {
                      source: "ren-inference",
                      id: "chatcmpl-1:anthropic-sonnet-1",
                      type: "model.call",
                      time,
                      workload: `brain:${Brain.ofSession(sessionId)}`,
                      organization: owner.organizationId,
                      brain: Brain.ofSession(sessionId),
                      space: owner.spaceId,
                      payer: "ren",
                      provider: "anthropic",
                      data: {
                        requested_model: "claude-sonnet-4-5",
                        served_model: "anthropic/claude-sonnet-4-5",
                      },
                    },
                  ],
                }),
                "application/json",
              ),
            ),
          )
          .pipe(Effect.flatMap((response) => Effect.map(response.json, (body) => [response.status, body] as const)))
      expect([yield* send("ren_usage_unknown"), yield* send("ren_usage_test")]).toMatchObject([
        [401, { _tag: "UnauthorizedError" }],
        [200, { inserted: 1 }],
      ])
    }),
  )
})
