import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { InferenceSearch } from "../../src/search/inference.js"

const it = testEffect(FetchHttpClient.layer)

it.live("search forwards the provider ID, query, key and usage headers and reads normalized results", () =>
  Effect.gen(function* () {
    const results = [{ url: "https://example.com", title: "Example", content: "Full page", time: { published: 123 } }]
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: async (request) => {
            expect(new URL(request.url).pathname).toBe("/v1/search")
            expect(request.headers.get("authorization")).toBe("Bearer key")
            expect(request.headers.get("ren-turn")).toBe("turn")
            expect(
              Schema.decodeUnknownSync(Schema.Struct({ providerID: Schema.String, query: Schema.String }))(
                await request.json(),
              ),
            ).toEqual({ providerID: "opaque/search", query: "Example" })
            return Response.json(results)
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    expect(
      yield* InferenceSearch.search(
        { id: "ren", baseUrl: `${server.url.origin}/v1`, apiKey: { key: Redacted.make("key") } },
        Effect.succeed(Redacted.make("key")),
        {
          providerID: "opaque/search",
          query: "Example",
          headers: { "ren-turn": "turn" },
        },
      ),
    ).toEqual(results)
  }),
)
