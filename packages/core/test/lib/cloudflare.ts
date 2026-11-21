export * as TestCloudflare from "./cloudflare.js"

import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { BunServices } from "@effect/platform-bun"

export const layer = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, (client) =>
    HttpClient.transformResponse(client, (response) =>
      response.pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
    ),
  ),
).pipe(Layer.provide(FetchHttpClient.layer), Layer.merge(BunServices.layer))
