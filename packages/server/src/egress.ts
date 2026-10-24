export * as EgressRoutes from "./egress.js"

import { BunHttpServer } from "@effect/platform-bun"
import { Egress } from "@ren/core/egress"
import { EgressApi } from "@ren/egress-api/egress-api"
import { Config, Effect, Layer, Option } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

// oxlint-disable-next-line ren/no-comments -- Ren's own egress reaches this listener only with a client certificate signed by EGRESS_TLS_CA, so every caller is Ren's egress (README §6.6 rule 1).
const ren: Egress.Principal = { kind: "ren", orgs: "all" }

const EgressHandler = HttpApiBuilder.group(EgressApi.Api, "egress", (handlers) =>
  Effect.gen(function* () {
    const egress = yield* Egress.Service
    const scope = yield* Effect.scope
    return handlers
      .handle("authenticate", (request) => egress.authenticate(ren, request.payload.proof))
      .handle("resolve", (request) => egress.resolve(ren, request.payload))
      .handle("unauthorized", (request) =>
        egress.unauthorized(ren, request.payload).pipe(Effect.forkIn(scope), Effect.asVoid),
      )
  }),
)

export const layer = HttpApiBuilder.layer(EgressApi.Api).pipe(Layer.provide(EgressHandler))

// oxlint-disable-next-line ren/no-comments -- An internal mTLS listener beside the public API, started only when EGRESS_PORT is set (C10, C22).
export const serve = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* Config.all({
      port: Config.option(Config.Port("EGRESS_PORT")),
      cert: Config.String("EGRESS_TLS_CERT").pipe(Config.withDefault("")),
      key: Config.String("EGRESS_TLS_KEY").pipe(Config.withDefault("")),
      ca: Config.String("EGRESS_TLS_CA").pipe(Config.withDefault("")),
    })
    if (Option.isNone(config.port)) return Layer.empty
    if (!config.cert || !config.key || !config.ca)
      return yield* Effect.die(new Error("EGRESS_PORT needs EGRESS_TLS_CERT, EGRESS_TLS_KEY and EGRESS_TLS_CA"))
    return HttpRouter.serve(layer).pipe(
      Layer.provide(
        BunHttpServer.layer({
          port: config.port.value,
          tls: {
            cert: Bun.file(config.cert),
            key: Bun.file(config.key),
            ca: Bun.file(config.ca),
            requestCert: true,
            rejectUnauthorized: true,
          },
        }),
      ),
    )
  }),
)
