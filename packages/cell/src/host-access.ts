export * as HostAccess from "./host-access.js"

import { EnvironmentAccess } from "@ren/brain/environment-access"
import { Effect, Layer, Option, Stream } from "effect"
import { Cell } from "./cell.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"

export const layer = (url: string) =>
  Layer.effect(
    EnvironmentAccess.Service,
    Effect.gen(function* () {
      const info = yield* Cell.Info
      const hostToken = yield* HostToken.Service
      const store = yield* ModelStore.Service
      const host = yield* HostToken.client(url)
      return EnvironmentAccess.Service.of({
        subscribe: Effect.succeed(Stream.never),
        open: Effect.fn("HostAccess.open")(function* (sessionId) {
          if (sessionId !== info.sessionId)
            return yield* new EnvironmentAccess.NotFound({
              sessionId,
              message: `This cell holds session ${info.sessionId}, not ${sessionId}`,
            })
          const unavailable = (message: string) => new EnvironmentAccess.Unavailable({ sessionId, message })
          const token = yield* hostToken.current
          if (Option.isNone(token)) return yield* unavailable("the cell has no valid host token")
          return yield* host.environments["environments.access"]().pipe(
            HostToken.withToken(token.value),
            Effect.timeout(HostToken.renAnswersWithin),
            Effect.catchTag("EnvironmentNotFoundError", (error) =>
              Effect.fail(new EnvironmentAccess.NotFound({ sessionId, message: error.message })),
            ),
            Effect.catchTag("ForbiddenError", (error) =>
              store.removeHostTokenIfUnchanged(token.value).pipe(
                Effect.andThen(Effect.fail(unavailable(`Ren refused the host token: ${error.message}`))),
              ),
            ),
            Effect.catchTag("EnvironmentUnavailableError", (error) => Effect.fail(unavailable(error.message))),
            Effect.catchIf(
              (error) => error._tag !== "EnvironmentAccess.NotFound" && error._tag !== "EnvironmentAccess.Unavailable",
              (error) => Effect.fail(unavailable(error.message)),
            ),
          )
        }),
      })
    }),
  )
