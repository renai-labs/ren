import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

export const bodyLimit = (maxBytes: number) =>
  HttpRouter.middleware((httpEffect) =>
    Effect.gen(function* () {
      const headers = (yield* HttpServerRequest.HttpServerRequest).headers
      if (headers["transfer-encoding"]) return HttpServerResponse.empty({ status: 411 })
      if (Number(headers["content-length"] ?? 0) > maxBytes) return HttpServerResponse.empty({ status: 413 })
      return yield* httpEffect
    }),
  ).layer
