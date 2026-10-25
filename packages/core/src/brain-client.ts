export * as BrainClient from "./brain-client.js"

import { BrainApi, hostTokenHeader } from "@ren/host-api/brain-api"
import { BrainToken } from "@ren/host-api/brain-token"
import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import type { Session } from "@ren/schema/session"
import { Signature } from "@ren/schema/signature"
import type { Array } from "effect"
import { Clock, Config, Context, Effect, identity, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { Signer } from "./signer.js"

export interface Target {
  readonly brainId: Brain.ID
  readonly generation: number
  readonly organizationId: Auth.OrganizationID
  readonly url: string
  readonly keyIds: ReadonlyArray<string>
  readonly egress: boolean
}

export interface Host {
  readonly brainId: Brain.ID
  readonly generation: number
  readonly organizationId: Auth.OrganizationID
}

export interface Interface {
  readonly renUrl: string
  readonly publicKeys: Array.NonEmptyReadonlyArray<Signature.PublicKey>
  readonly brain: (target: Target) => Effect.Effect<HttpApiClient.ForApi<typeof BrainApi>>
  readonly hostToken: (host: Host) => Effect.Effect<string>
  readonly clientToken: (
    target: Target,
    claims: {
      readonly sid: Session.ID
      readonly sub: Auth.UserID
      readonly member: typeof Auth.MemberID.Type
      readonly name?: string
    },
  ) => Effect.Effect<{ readonly token: string; readonly exp: number }>
  readonly verify: (token: string) => Effect.Effect<Option.Option<BrainToken.Claims>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainClient") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      renUrl: Config.String("REN_URL").pipe(Config.withDefault("http://localhost:4000")),
      address: Config.option(Config.String("REN_URL")),
    })
    const signer = yield* Signer.Service
    const publicKeys = yield* signer.publicKeys("brain").pipe(Effect.orDie)
    const http = yield* HttpClient.HttpClient
    const now = Effect.map(Clock.currentTimeMillis, (millis) => Math.floor(millis / 1000))
    const hostToken = Effect.fnUntraced(function* (host: Host) {
      const iat = yield* now
      return yield* signer
        .sign("brain", {
          scope: "host",
          brain: host.brainId,
          gen: host.generation,
          org: host.organizationId,
          iat,
          exp: iat + BrainToken.lifetimes.host,
        })
        .pipe(Effect.orDie)
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
                  yield* signer
                    .sign(
                      "brain",
                      {
                        scope: "server",
                        brain: target.brainId,
                        gen: target.generation,
                        exp: issued + BrainToken.lifetimes.server,
                        // oxlint-disable-next-line ren/no-comments -- A brain behind the egress holds no host token and keeps REN_URL as Ren's address: the egress injects the token on calls to that host (C8, C49).
                        ...Option.match(target.egress ? Option.none() : config.address, {
                          onNone: () => ({}),
                          onSome: (ren) => ({ ren }),
                        }),
                      },
                      { holders: target.keyIds },
                    )
                    .pipe(Effect.orDie),
                ),
                target.egress ? identity : HttpClientRequest.setHeader(hostTokenHeader, yield* hostToken(target)),
              )
            }),
          ),
        }),
      clientToken: Effect.fnUntraced(function* (target, claims) {
        const exp = (yield* now) + BrainToken.lifetimes.client
        return {
          exp,
          token: yield* signer
            .sign(
              "brain",
              {
                scope: "client",
                brain: target.brainId,
                gen: target.generation,
                sid: claims.sid,
                sub: claims.sub,
                member: claims.member,
                ...(claims.name && { name: claims.name }),
                exp,
              },
              { holders: target.keyIds },
            )
            .pipe(Effect.orDie),
        }
      }),
      verify: (token) => BrainToken.verify(publicKeys, token),
    })
  }),
)
