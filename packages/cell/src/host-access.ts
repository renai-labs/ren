export * as HostAccess from "./host-access.js"

import { EnvironmentAccess } from "@ren/brain/environment/access"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import type { Session } from "@ren/schema/session"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { Cell } from "./cell.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"
import { RenAddress } from "./ren-address.js"

export const layer = Layer.effect(
  EnvironmentAccess.Service,
  Effect.gen(function* () {
    const info = yield* Cell.Info
    const hostToken = yield* HostToken.Service
    const store = yield* ModelStore.Service
    if (!info.vars.REN_URL) return yield* Effect.die(new Error("HostAccess needs REN_URL"))
    const host = yield* HostToken.client(info.vars.REN_URL).pipe(Effect.provide(RenAddress.http))
    const withHostToken = Effect.fnUntraced(function* (sessionId: Session.ID) {
      const unavailable = (message: string) => new EnvironmentAccess.Unavailable({ sessionId, message })
      const token = yield* hostToken.current
      if (Option.isNone(token)) return yield* unavailable("the cell has no valid host token")
      return { token: token.value, unavailable }
    })
    return EnvironmentAccess.Service.of({
      open: Effect.fn("HostAccess.open")(function* (sessionId) {
        const presented = yield* withHostToken(sessionId)
        return yield* host.environments["environments.access"]({ params: { id: sessionId } }).pipe(
          HostToken.withToken(presented.token),
          Effect.timeout(HostToken.renAnswersWithin),
          Effect.catchTag("EnvironmentNotFoundError", (error) =>
            Effect.fail(new EnvironmentAccess.NotFound({ sessionId, message: error.message })),
          ),
          Effect.catchTag("ForbiddenError", (error) =>
            store
              .removeHostTokenIfUnchanged(presented.token)
              .pipe(Effect.andThen(Effect.fail(presented.unavailable(`Ren refused the host token: ${error.message}`)))),
          ),
          Effect.catchTag("EnvironmentUnavailableError", (error) => Effect.fail(presented.unavailable(error.message))),
          Effect.catchIf(
            (error) => error._tag !== "EnvironmentAccess.NotFound" && error._tag !== "EnvironmentAccess.Unavailable",
            (error) => Effect.fail(presented.unavailable(error.message)),
          ),
        )
      }),
      release: Effect.fn("HostAccess.release")(function* (sessionId) {
        const presented = yield* withHostToken(sessionId)
        return yield* host.environments["environments.release"]({ params: { id: sessionId } }).pipe(
          HostToken.withToken(presented.token),
          Effect.timeout(HostToken.renAnswersWithin),
          Effect.mapError((error) => presented.unavailable(error.message)),
        )
      }),
    })
  }),
)

export const connections = Layer.unwrap(
  Effect.gen(function* () {
    const info = yield* Cell.Info
    if (!info.vars.REN_URL) return Layer.empty
    return EnvironmentConnections.layer.pipe(Layer.provide(layer), Layer.provide(FetchHttpClient.layer))
  }),
)
