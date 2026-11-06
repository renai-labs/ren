import { WebhookDelivery } from "@ren/schema/webhook-delivery"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { NotFoundError } from "../errors.js"
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
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "webhook-parser" }))
