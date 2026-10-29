export * as Connection from "./connection.js"

import { Ren } from "@renai-labs/sdk/effect"
import { Clock, Context, Effect, FileSystem, Layer } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Release } from "../release.js"
import { Upgrade } from "../upgrade.js"
import { Credentials } from "./credentials.js"
import { OAuth } from "./oauth.js"

export type Client = Effect.Success<ReturnType<typeof Ren.make>>

export class Service extends Context.Service<
  Service,
  {
    readonly server: Effect.Effect<URL, Error>
    readonly connect: (token?: string) => Effect.Effect<Client, Error>
    readonly client: Effect.Effect<Client, Error>
  }
>()("@ren/cli/Connection") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const fs = yield* FileSystem.FileSystem
    const credentials = yield* Credentials.Service
    const url = process.env.REN_URL ?? Release.apiUrl
    const parsed = URL.parse(url)
    const gate = yield* Effect.cached(
      Upgrade.gate.pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.provideService(FileSystem.FileSystem, fs),
      ),
    )
    const server = Effect.andThen(
      gate,
      parsed && ["http:", "https:"].includes(parsed.protocol)
        ? Effect.succeed(parsed)
        : Effect.fail(new Error(`Invalid REN_URL: ${url}`)),
    )
    const connect = Effect.fn("Connection.connect")(function* (token?: string) {
      const baseUrl = yield* server
      return yield* Ren.make({ baseUrl }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          token ? HttpClient.mapRequest(http, HttpClientRequest.bearerToken(token)) : http,
        ),
      )
    })
    const token = yield* Effect.cached(
      Effect.gen(function* () {
        if (process.env.REN_TOKEN) return process.env.REN_TOKEN
        const origin = yield* server
        const stored = yield* credentials.get(origin)
        if (!stored) return yield* Effect.fail(new Error(`Not logged in to ${origin.origin}. Run ren2 login.`))
        if (stored.expiresAt - 60_000 > (yield* Clock.currentTimeMillis)) return stored.accessToken
        const refreshed = yield* OAuth.discover(origin).pipe(
          Effect.flatMap((endpoints) =>
            OAuth.token(endpoints, { grant_type: "refresh_token", refresh_token: stored.refreshToken }),
          ),
          Effect.provideService(HttpClient.HttpClient, http),
        )
        yield* credentials.set(origin, refreshed)
        return refreshed.accessToken
      }),
    )
    return { server, connect, client: Effect.flatMap(token, connect) }
  }),
)
