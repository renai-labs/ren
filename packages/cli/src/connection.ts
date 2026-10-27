export * as Connection from "./connection.js"

import { Ren } from "@renai-labs/sdk/effect"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"

type Client = Effect.Success<ReturnType<typeof Ren.make>>

const http = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, (http) => {
    const token = process.env.REN_TOKEN
    return token ? HttpClient.mapRequest(http, HttpClientRequest.bearerToken(token)) : http
  }),
).pipe(Layer.provide(FetchHttpClient.layer))

export const run = <A, E>(use: (client: Client) => Effect.Effect<A, E>) => {
  const baseUrl = URL.parse(process.env.REN_URL ?? "http://localhost:4000")
  if (!baseUrl) return Promise.reject(new Error(`Invalid REN_URL: ${process.env.REN_URL}`))
  return Effect.runPromise(Ren.make({ baseUrl }).pipe(Effect.flatMap(use), Effect.provide(http)))
}
