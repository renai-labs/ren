export * as Connection from "./connection.js"

import { Ren } from "@renai-labs/sdk/effect"
import { Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"

type Client = Effect.Success<ReturnType<typeof Ren.make>>

export class Service extends Context.Service<
  Service,
  {
    readonly client: Effect.Effect<Client, Error>
  }
>()("@ren/cli/Connection") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const url = process.env.REN_URL ?? "http://localhost:4000"
    const token = process.env.REN_TOKEN
    const http = Layer.effect(
      HttpClient.HttpClient,
      Effect.map(HttpClient.HttpClient, (client) =>
        token ? HttpClient.mapRequest(client, HttpClientRequest.bearerToken(token)) : client,
      ),
    ).pipe(Layer.provide(FetchHttpClient.layer))
    const client = yield* Effect.cached(
      Effect.gen(function* () {
        const baseUrl = URL.parse(url)
        if (!baseUrl || !["http:", "https:"].includes(baseUrl.protocol))
          return yield* Effect.fail(new Error(`Invalid REN_URL: ${url}`))
        return yield* Ren.make({ baseUrl })
      }).pipe(Effect.provide(http)),
    )
    return { client }
  }),
)
