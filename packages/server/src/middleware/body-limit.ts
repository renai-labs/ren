import { Effect, Option, Semaphore } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

// oxlint-disable-next-line ren/no-comments -- A body has a length and is at most maxBytes, checked before it is read. With inFlightBytes, the bodies that the server handles at once stay under that many bytes: a request that does not fit now gets 503, and its caller tries again (a brain's sync does).
export const bodyLimit = (maxBytes: number, options: { readonly inFlightBytes?: number } = {}) => {
  const inFlight = Option.map(Option.fromNullishOr(options.inFlightBytes), Semaphore.makeUnsafe)
  return HttpRouter.middleware((httpEffect) =>
    Effect.gen(function* () {
      const headers = (yield* HttpServerRequest.HttpServerRequest).headers
      if (headers["transfer-encoding"]) return HttpServerResponse.empty({ status: 411 })
      const length = Number(headers["content-length"] ?? 0)
      if (length > maxBytes) return HttpServerResponse.empty({ status: 413 })
      if (Option.isNone(inFlight)) return yield* httpEffect
      return Option.getOrElse(yield* httpEffect.pipe(inFlight.value.withPermitsIfAvailable(length)), () =>
        HttpServerResponse.empty({ status: 503 }),
      )
    }),
  ).layer
}
