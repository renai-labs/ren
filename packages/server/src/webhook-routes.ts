export * as WebhookRoutes from "./webhook-routes.js"

import { Intake } from "@ren/core/intake"
import { Webhook } from "@ren/schema/webhook"
import { Effect } from "effect"
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http"
import { IntakeRequest } from "./intake-request.js"

// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const intake = yield* Intake.Service
    const receive = (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        // oxlint-disable-next-line ren/no-comments -- The webhook source records a body over 1 MB as rejected, with its headers only, so the edge does not read it.
        const tooLarge = Number(request.headers["content-length"] ?? 0) > Webhook.maximumBodyBytes
        const body = tooLarge ? "" : yield* request.text
        return IntakeRequest.response(yield* intake.receive("webhook", IntakeRequest.of(request, body)))
      }).pipe(Effect.catchTag("HttpServerError", () => Effect.succeed(HttpServerResponse.empty({ status: 400 }))))
    yield* router.add("POST", "/webhooks/:id/:token", receive)
    yield* router.add("GET", "/webhooks/:id/:token", receive)
  }),
)
