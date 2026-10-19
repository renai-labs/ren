export * as HostAccess from "./host-access.js"

import { HandAccess } from "@ren/brain/hand-access"
import type { Session } from "@ren/schema/session"
import { Effect, Layer, Option } from "effect"
import { Cell } from "./cell.js"
import { HostToken } from "./host-token.js"
import { ModelStore } from "./model-store.js"

export const layer = Layer.effect(
  HandAccess.Service,
  Effect.gen(function* () {
    const info = yield* Cell.Info
    const hostToken = yield* HostToken.Service
    const store = yield* ModelStore.Service
    if (!info.vars.REN_URL) return yield* Effect.die(new Error("HostAccess needs REN_URL"))
    const host = yield* HostToken.client(info.vars.REN_URL)
    const withHostToken = Effect.fnUntraced(function* (sessionId: Session.ID) {
      const unavailable = (message: string) => new HandAccess.Unavailable({ sessionId, message })
      if (sessionId !== info.sessionId)
        return yield* unavailable(`This cell holds session ${info.sessionId}, not ${sessionId}`)
      const token = yield* hostToken.current
      if (Option.isNone(token)) return yield* unavailable("the cell has no valid host token")
      return { token: token.value, unavailable }
    })
    return HandAccess.Service.of({
      open: Effect.fn("HostAccess.open")(function* (sessionId) {
        if (sessionId !== info.sessionId)
          return yield* new HandAccess.NotFound({
            sessionId,
            message: `This cell holds session ${info.sessionId}, not ${sessionId}`,
          })
        const presented = yield* withHostToken(sessionId)
        return yield* host.hands["hands.access"]().pipe(
          HostToken.withToken(presented.token),
          Effect.timeout(HostToken.renAnswersWithin),
          Effect.catchTag("HandNotFoundError", (error) =>
            Effect.fail(new HandAccess.NotFound({ sessionId, message: error.message })),
          ),
          Effect.catchTag("ForbiddenError", (error) =>
            store
              .removeHostTokenIfUnchanged(presented.token)
              .pipe(Effect.andThen(Effect.fail(presented.unavailable(`Ren refused the host token: ${error.message}`)))),
          ),
          Effect.catchTag("HandUnavailableError", (error) => Effect.fail(presented.unavailable(error.message))),
          Effect.catchIf(
            (error) => error._tag !== "HandAccess.NotFound" && error._tag !== "HandAccess.Unavailable",
            (error) => Effect.fail(presented.unavailable(error.message)),
          ),
        )
      }),
      release: Effect.fn("HostAccess.release")(function* (sessionId) {
        const presented = yield* withHostToken(sessionId)
        return yield* host.hands["hands.release"]().pipe(
          HostToken.withToken(presented.token),
          Effect.timeout(HostToken.renAnswersWithin),
          Effect.mapError((error) => presented.unavailable(error.message)),
        )
      }),
    })
  }),
)
