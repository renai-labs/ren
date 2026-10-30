export * as Search from "./search.js"

import type { ModelTypes } from "@ren/schema/model-types"
import { Cause, Effect, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ModelHttp } from "./model-http.js"

const Body = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      title: Schema.optionalKey(Schema.NullOr(Schema.String)),
      snippet: Schema.optionalKey(Schema.NullOr(Schema.String)),
      raw_content: Schema.optionalKey(Schema.NullOr(Schema.String)),
      date: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
})

class Failure extends Schema.TaggedError<Failure>()("Search.Failure", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

interface Request {
  readonly model: string
  readonly query: string
  readonly headers: Readonly<Record<string, string>>
}

export const search = Effect.fn("Search.search")(
  function* (provider: ModelTypes.Provider, key: Effect.Effect<Redacted.Redacted>, request: Request) {
    const options = ModelHttp.options(provider, key, request.headers)
    const client = (yield* HttpClient.HttpClient).pipe(options.transformClient, HttpClient.filterStatusOk)
    const body = yield* client
      .execute(
        HttpClientRequest.post(`${options.apiUrl}/search`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ search_tool_name: request.model, query: request.query }),
        ),
      )
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Body)))
    return body.results.map((result) => {
      const published = Date.parse(result.date ?? "")
      return {
        url: result.url,
        title: result.title ?? undefined,
        content: result.raw_content ?? result.snippet ?? undefined,
        time: Number.isFinite(published) ? { published } : {},
      }
    })
  },
  Effect.mapError((cause) => new Failure({ message: Cause.pretty(Cause.fail(cause)), cause })),
)
