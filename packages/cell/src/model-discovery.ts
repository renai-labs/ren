export * as ModelDiscovery from "./model-discovery.js"

import { Models } from "@ren/schema/models"
import { SearchProvider } from "@ren/schema/search-provider"
import { Effect, Option, Redacted } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { Harness } from "./harness/harness.js"
import type { ModelCatalog } from "./model-catalog.js"

export const refresh = Effect.fn("ModelDiscovery.refresh")(function* (
  catalog: ModelCatalog.Interface,
  keyFor: Harness.Refresh,
) {
  const snapshot = yield* catalog.snapshot
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  yield* Effect.forEach(
    snapshot.providers,
    (provider) =>
      Effect.gen(function* () {
        if (provider.catalog !== "inference") return
        const key = yield* keyFor(provider.id)
        if (Option.isNone(key)) return
        const get = (path: string) =>
          http.execute(
            HttpClientRequest.get(`${provider.baseUrl.replace(/\/+$/u, "")}${path}`).pipe(
              HttpClientRequest.setHeaders(provider.headers ?? {}),
              HttpClientRequest.bearerToken(Redacted.value(key.value.key)),
            ),
          )
        yield* Effect.all(
          [
            get("/catalog").pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(Models.InferenceCatalog)),
              Effect.timeout("10 seconds"),
              Effect.flatMap((found) => catalog.update(snapshot.generation, provider.id, { models: found.models })),
              Effect.catch((error) =>
                Effect.logWarning(`Model discovery failed for ${provider.id}; keeping its last models`, error),
              ),
            ),
            get("/search/providers").pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchProvider.Providers)),
              Effect.timeout("10 seconds"),
              Effect.flatMap((search) => catalog.update(snapshot.generation, provider.id, { search })),
              Effect.catch((error) =>
                Effect.logWarning(
                  `Search discovery failed for ${provider.id}; keeping its last search providers`,
                  error,
                ),
              ),
            ),
          ],
          { concurrency: "unbounded", discard: true },
        )
      }),
    { concurrency: "unbounded", discard: true },
  )
})
