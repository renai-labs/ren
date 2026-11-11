import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { Search } from "../src/search.js"

const it = testEffect(FetchHttpClient.layer)

it.live("search prefers the page content over the snippet and drops a date it cannot parse", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: () =>
            Response.json({
              results: [
                {
                  url: "https://effect.website",
                  title: "Effect",
                  snippet: "Summary",
                  raw_content: "Full page",
                  date: "2026-01-01",
                },
                { url: "https://example.com", snippet: "Summary", date: "unknown" },
              ],
            }),
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const key = Effect.succeed(Redacted.make("key"))
    expect(
      yield* Search.search({ id: "ren", baseUrl: server.url.origin, apiKey: { key: Redacted.make("key") } }, key, {
        model: "search",
        query: "Effect",
        headers: {},
      }),
    ).toEqual([
      {
        url: "https://effect.website",
        title: "Effect",
        content: "Full page",
        time: { published: Date.parse("2026-01-01") },
      },
      { url: "https://example.com", title: undefined, content: "Summary", time: {} },
    ])
  }),
)
