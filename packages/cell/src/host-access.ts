export * as HostAccess from "./host-access.js"

import { HandAccess } from "@ren/brain/hand-access"
import { Effect, Layer, Option } from "effect"
import { Cell } from "./cell.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"

export const layer = (url: string) =>
  Layer.effect(
    HandAccess.Service,
    Effect.gen(function* () {
      const info = yield* Cell.Info
      const hostToken = yield* HostToken.Service
      const store = yield* ModelStore.Service
      const host = yield* HostToken.client(url)
      return HandAccess.Service.of({
        open: Effect.fn("HostAccess.open")(function* (sessionId) {
          if (sessionId !== info.sessionId)
            return yield* new HandAccess.NotFound({
              sessionId,
              message: `This cell holds session ${info.sessionId}, not ${sessionId}`,
            })
          const unavailable = (message: string) => new HandAccess.Unavailable({ sessionId, message })
          const token = yield* hostToken.current
          if (Option.isNone(token)) return yield* unavailable("the cell has no valid host token")
          return yield* host.environments["environments.access"]().pipe(
            HostToken.withToken(token.value),
            Effect.timeout(HostToken.renAnswersWithin),
            Effect.catchTag("EnvironmentNotFoundError", (error) =>
              Effect.fail(new HandAccess.NotFound({ sessionId, message: error.message })),
            ),
            Effect.catchTag("ForbiddenError", (error) =>
              store
                .removeHostTokenIfUnchanged(token.value)
                .pipe(Effect.andThen(Effect.fail(unavailable(`Ren refused the host token: ${error.message}`)))),
            ),
            Effect.catchTag("EnvironmentUnavailableError", (error) => Effect.fail(unavailable(error.message))),
            Effect.catchIf(
              (error) => error._tag !== "HandAccess.NotFound" && error._tag !== "HandAccess.Unavailable",
              (error) => Effect.fail(unavailable(error.message)),
            ),
          )
        }),
        release: Effect.fn("HostAccess.release")(function* (sessionId) {
          const unavailable = (message: string) => new HandAccess.Unavailable({ sessionId, message })
          if (sessionId !== info.sessionId)
            return yield* unavailable(`This cell holds session ${info.sessionId}, not ${sessionId}`)
          const token = yield* hostToken.current
          if (Option.isNone(token)) return yield* unavailable("the cell has no valid host token")
          return yield* host.environments["environments.release"]().pipe(
            HostToken.withToken(token.value),
            Effect.timeout(HostToken.renAnswersWithin),
            Effect.mapError((error) => unavailable(error.message)),
          )
        }),
      })
    }),
  )
