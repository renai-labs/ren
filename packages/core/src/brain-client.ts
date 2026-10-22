export * as BrainClient from "./brain-client.js"

import { BrainApi } from "@ren/host-api/brain-api"
import { BrainToken } from "@ren/host-api/brain-token"
import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import type { Session } from "@ren/schema/session"
import { Signature } from "@ren/schema/signature"
import { Array, Clock, Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"

export interface Target {
  readonly brainId: Brain.ID
  readonly generation: number
  readonly organizationId: Auth.OrganizationID
  readonly url: string
  readonly keyIds: ReadonlyArray<string>
}

export interface Host {
  readonly brainId: Brain.ID
  readonly generation: number
  readonly organizationId: Auth.OrganizationID
}

export const hostTokenHeader = "ren-host-token"

export interface Interface {
  readonly renUrl: string
  readonly publicKeys: ReadonlyArray<Signature.PublicKey>
  readonly brain: (target: Target) => Effect.Effect<HttpApiClient.ForApi<typeof BrainApi>>
  readonly hostToken: (host: Host) => Effect.Effect<string>
  readonly clientToken: (
    target: Target,
    claims: { readonly sid: Session.ID; readonly sub: Auth.UserID; readonly name?: string },
  ) => Effect.Effect<{ readonly token: string; readonly exp: number }>
  readonly verify: (token: string) => Effect.Effect<Option.Option<BrainToken.Claims>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainClient") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      keys: Config.schema(Schema.RedactedFromValue(Signature.PrivateKeys), "BRAIN_KEYS"),
      renUrl: Config.String("REN_URL").pipe(Config.withDefault("http://localhost:4000")),
    })
    const keys = Redacted.value(config.keys)
    const publicKeys = yield* BrainToken.publicKeys(keys)
    const http = yield* HttpClient.HttpClient
    const now = Effect.map(Clock.currentTimeMillis, (millis) => Math.floor(millis / 1000))
    const signerFor = (keyIds: ReadonlyArray<string>) =>
      keys.find((key) => keyIds.includes(key.id)) ?? Array.headNonEmpty(keys)
    const hostToken = Effect.fnUntraced(function* (host: Host) {
      const iat = yield* now
      return yield* BrainToken.sign(Array.headNonEmpty(keys), {
        scope: "host",
        brain: host.brainId,
        gen: host.generation,
        org: host.organizationId,
        iat,
        exp: iat + BrainToken.lifetimes.host,
      })
    })
    return Service.of({
      renUrl: config.renUrl,
      publicKeys,
      hostToken,
      brain: (target) =>
        HttpApiClient.makeWith(BrainApi, {
          baseUrl: target.url,
          httpClient: HttpClient.mapRequestEffect(http, (request) =>
            Effect.gen(function* () {
              const issued = yield* now
              return request.pipe(
                HttpClientRequest.basicAuth(
                  "ren",
                  yield* BrainToken.sign(signerFor(target.keyIds), {
                    scope: "server",
                    brain: target.brainId,
                    gen: target.generation,
                    exp: issued + BrainToken.lifetimes.server,
                  }),
                ),
                HttpClientRequest.setHeader(hostTokenHeader, yield* hostToken(target)),
              )
            }),
          ),
        }),
      clientToken: Effect.fnUntraced(function* (target, claims) {
        const exp = (yield* now) + BrainToken.lifetimes.client
        return {
          exp,
          token: yield* BrainToken.sign(signerFor(target.keyIds), {
            scope: "client",
            brain: target.brainId,
            gen: target.generation,
            sid: claims.sid,
            sub: claims.sub,
            ...(claims.name && { name: claims.name }),
            exp,
          }),
        }
      }),
      verify: (token) => BrainToken.verify(publicKeys, token),
    })
  }),
)
