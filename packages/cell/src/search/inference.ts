export * as InferenceSearch from "./inference.js"

import { Cause, Effect, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ProviderHttp } from "../provider-http.js"
import { SearchProvider } from "@ren/schema/search-provider"

class Failure extends Schema.TaggedError<Failure>()("InferenceSearch.Failure", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

interface Request {
  readonly providerID: string
  readonly query: string
  readonly headers: Readonly<Record<string, string>>
}

export const search = Effect.fn("InferenceSearch.search")(
  function* (provider: ProviderHttp.Connection, key: Effect.Effect<Redacted.Redacted>, request: Request) {
    const options = ProviderHttp.options(provider, key, request.headers)
    const client = (yield* HttpClient.HttpClient).pipe(options.transformClient, HttpClient.filterStatusOk)
    return yield* client
      .execute(
        HttpClientRequest.post(`${options.apiUrl}/search`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ providerID: request.providerID, query: request.query }),
        ),
      )
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchProvider.Results)))
  },
  Effect.mapError((cause) => new Failure({ message: Cause.pretty(Cause.fail(cause)), cause })),
)
