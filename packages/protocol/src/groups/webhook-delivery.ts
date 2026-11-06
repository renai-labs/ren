import { WebhookDelivery } from "@ren/schema/webhook-delivery"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"
import { Primitive } from "../primitive.js"

export const WebhookDeliveryGroup = Primitive.group(WebhookDelivery.definition, "sdk", [
  Primitive.list(WebhookDelivery.definition),
])

export const WebhookParserGroup = HttpApiGroup.make("webhook-parser")
  .add(
    HttpApiEndpoint.post("webhook-delivery.test", "/webhook-deliveries/test", {
      payload: WebhookDelivery.TestInput,
      success: WebhookDelivery.TestResult,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "webhook-delivery.test",
        summary: "Test a webhook parser",
        description:
          "Run a parser, or the webhook’s own, on stored requests and return what each would do: answered, started, continued, ignored, duplicate or rejected, with the reason. Saves nothing.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("webhook-delivery.replay", "/webhook-deliveries/replay", {
      payload: WebhookDelivery.ReplayInput,
      success: WebhookDelivery.Replayed,
      error: [NotFoundError, ForbiddenError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "webhook-delivery.replay",
        summary: "Replay a webhook’s recorded requests",
        description:
          "Run the parser of a live webhook on its recorded and throttled requests, oldest first, and start their chats. Each request starts at most one chat.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "webhook-parser" }))
