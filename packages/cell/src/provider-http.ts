export * as ProviderHttp from "./provider-http.js"

import type { Models } from "@ren/schema/models"
import { Effect, Option, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { Harness } from "./harness/harness.js"

export type Connection = Pick<Models.Endpoint, "id" | "baseUrl" | "headers" | "apiKey">

export const options = (
  provider: Connection,
  key: Effect.Effect<Redacted.Redacted>,
  headers: Readonly<Record<string, string>> = {},
) => ({
  apiUrl: provider.baseUrl.replace(/\/+$/u, ""),
  transformClient: (client: HttpClient.HttpClient) =>
    client.pipe(
      HttpClient.mapRequest(HttpClientRequest.setHeaders({ ...provider.headers, ...headers })),
      HttpClient.mapRequestEffect((request) =>
        Effect.map(key, (value) => HttpClientRequest.bearerToken(request, Redacted.value(value))),
      ),
      HttpClient.transformResponse(Effect.repeat({ times: 1, while: (response) => response.status === 401 })),
    ),
})

// oxlint-disable-next-line ren/no-comments -- The provider's own key, refreshed when it is about to expire; never another provider's.
export const key = (provider: Connection, keyFor: Harness.Refresh) =>
  keyFor(provider.id).pipe(Effect.map((found) => Option.getOrElse(found, () => provider.apiKey).key))
