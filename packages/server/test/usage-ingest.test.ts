import { describe, expect } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Seed, testEffect } from "@ren/core/testing"
import { Database } from "@ren/db/database"
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
    Layer.provide(
      environment(undefined, { USAGE_INGEST_KEY: "ren_usage_test", INTEGRATIONS_INGEST_KEY: "ren_integrations_test" }),
    ),
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

  it.live("a call keeps the gateway's operation and the usage the provider reported", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const http = yield* HttpClient.HttpClient
      const database = yield* Database.Service
      const data = {
        requested_model: "ren/gpt-transcribe",
        served_model: "ren/gpt-transcribe",
        operation: "transcription",
        usage: { type: "duration", seconds: 2 },
      }
      const response = yield* http.execute(
        HttpClientRequest.post("/usage/v1/events").pipe(
          HttpClientRequest.bearerToken("ren_usage_test"),
          HttpClientRequest.bodyJsonUnsafe({
            events: [
              {
                source: "ren-inference",
                id: "image-1:deployment-image",
                type: "model.call",
                time: DateTime.formatIso(yield* DateTime.now),
                workload: "brain:tools",
                organization: owner.organizationId,
                payer: "ren",
                provider: "openai",
                cost_micro_usd: 42000,
                data,
              },
            ],
          }),
        ),
      )
      expect(yield* response.json).toEqual({ inserted: 1 })
      expect(yield* database.db.select().from(Database.Schema.usage_event).pipe(Effect.orDie)).toMatchObject([{ data }])
    }),
  )

  it.live("the integrations key records only ren-integrations rows", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const http = yield* HttpClient.HttpClient
      const database = yield* Database.Service
      const time = DateTime.formatIso(yield* DateTime.now)
      const event = (source: string, id: string, cost: number) => ({
        source,
        id,
        type: "api.call",
        time,
        workload: "brain:brn_1",
        organization: owner.organizationId,
        space: owner.spaceId,
        payer: "ren",
        provider: "kernel",
        cost_micro_usd: cost,
        data: { mcp: "kernel-managed", upstream: "browsers", units: { uptime_ms: 1200 } },
      })
      const send = (secret: string, events: ReadonlyArray<unknown>) =>
        http
          .execute(
            HttpClientRequest.post("/usage/v1/events").pipe(
              HttpClientRequest.bearerToken(secret),
              HttpClientRequest.bodyJsonUnsafe({ events }),
            ),
          )
          .pipe(Effect.flatMap((response) => Effect.map(response.json, (body) => [response.status, body] as const)))
      expect([
        yield* send("ren_integrations_test", [
          event("ren-integrations", "kernel:abc", 20),
          event("ren-inference", "chatcmpl-2:anthropic-sonnet-1", 5),
        ]),
        yield* send("ren_integrations_test", [event("ren-integrations", "kernel:abc", 20)]),
      ]).toMatchObject([
        [403, { _tag: "ForbiddenError" }],
        [200, { inserted: 1 }],
      ])
      expect(
        yield* database.db
          .select({ id: Database.Schema.usage_event.id, cost: Database.Schema.usage_event.cost_micro_usd })
          .from(Database.Schema.usage_event)
          .pipe(Effect.orDie),
      ).toEqual([{ id: "kernel:abc", cost: 20 }])
    }),
  )
})
