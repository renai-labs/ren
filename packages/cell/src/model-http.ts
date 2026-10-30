export * as ModelHttp from "./model-http.js"

import type { ModelTypes } from "@ren/schema/model-types"
import { Effect, Redacted } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

export const options = (
  provider: ModelTypes.Provider,
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
