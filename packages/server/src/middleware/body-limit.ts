import { Effect, Option, Semaphore } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

interface Limit {
  readonly maxBytes: number
  readonly inFlightBytes?: number
}

const make = (limit: Limit) => ({
  maxBytes: limit.maxBytes,
  inFlight: Option.map(Option.fromNullishOr(limit.inFlightBytes), Semaphore.makeUnsafe),
})

// oxlint-disable-next-line ren/no-comments -- A body has a length and is at most maxBytes, checked before it is read. With inFlightBytes, the bodies that the server handles at once stay under that many bytes: a request that does not fit now gets 503, and its caller tries again (a brain's sync does). A route in `routes` whose path matches has its own limit instead.
export const bodyLimit = (
  maxBytes: number,
  options: {
    readonly inFlightBytes?: number
    readonly routes?: ReadonlyArray<Limit & { readonly path: RegExp }>
  } = {},
) => {
  const base = make({ maxBytes, ...(options.inFlightBytes && { inFlightBytes: options.inFlightBytes }) })
  const routes = (options.routes ?? []).map((route) => ({ path: route.path, limit: make(route) }))
  return HttpRouter.middleware((httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const headers = request.headers
      const path = request.url.split("?").at(0) ?? ""
      const limit = routes.find((route) => route.path.test(path))?.limit ?? base
      if (headers["transfer-encoding"]) return HttpServerResponse.empty({ status: 411 })
      const length = Number(headers["content-length"] ?? 0)
      if (length > limit.maxBytes) return HttpServerResponse.empty({ status: 413 })
      if (Option.isNone(limit.inFlight)) return yield* httpEffect
      return Option.getOrElse(yield* httpEffect.pipe(limit.inFlight.value.withPermitsIfAvailable(length)), () =>
        HttpServerResponse.empty({ status: 503 }),
      )
    }),
  ).layer
}
