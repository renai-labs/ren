export * as WebhookRoutes from "./webhook-routes.js"

import { Intake } from "@ren/core/intake"
import { Webhook } from "@ren/schema/webhook"
import { ByteSize, Effect, Result } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { IntakeRequest } from "./intake-request.js"

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const intake = yield* Intake.Service
    const receive = (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const read = yield* Effect.result(
          request.text.pipe(
            Effect.provideService(HttpServerRequest.MaxBodySize, ByteSize.bytes(Webhook.maximumBodyBytes)),
          ),
        )
        if (Result.isSuccess(read))
          return IntakeRequest.response(
            yield* intake.receive("webhook", IntakeRequest.of(request, params, read.success)),
          )
        const reason = read.failure.reason
        if (reason._tag !== "RequestParseError" || reason.reason !== "BodyTooLarge")
          return HttpServerResponse.empty({ status: 400 })
        return IntakeRequest.response(
          yield* intake.receive("webhook", { ...IntakeRequest.of(request, params, ""), bodyTooLarge: true }),
        )
      })
    yield* router.add("POST", "/webhooks/:id/:token", receive)
    yield* router.add("GET", "/webhooks/:id/:token", receive)
  }),
)
