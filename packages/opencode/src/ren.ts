export * as RenApi from "./ren.js"

import { Ren } from "@ren/client/effect"
import { Context, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { RenAuth } from "./auth.js"

export type Client = Effect.Success<ReturnType<typeof Ren.make>>

export class Service extends Context.Service<
  Service,
  {
    readonly server: URL
    readonly client: Effect.Effect<Client, RenAuth.SignedOut | RenAuth.AuthError>
  }
>()("@ren/opencode/RenApi") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const auth = yield* RenAuth.Service
    return Service.of({
      server: auth.server,
      client: Effect.flatMap(auth.token, (token) =>
        Ren.make({ baseUrl: auth.server }).pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.mapRequest(http, HttpClientRequest.bearerToken(token)),
          ),
        ),
      ),
    })
  }),
)
