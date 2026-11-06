import { Webhooks } from "@ren/core/webhooks"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const WebhookHandler = HttpApiBuilder.group(Api, "webhook", (handlers) =>
  Effect.gen(function* () {
    const webhooks = yield* Webhooks.Service
    return handlers
      .handle("webhook.list", Primitive.list(webhooks.list))
      .handle("webhook.get", Primitive.get(webhooks.get))
      .handle("webhook.create", Primitive.create(webhooks.create))
      .handle("webhook.update", Primitive.update(webhooks.update))
      .handle("webhook.archive", Primitive.archive(webhooks.archive))
      .handle("webhook.rotateUrl", Primitive.action(webhooks.rotateUrl))
      .handle("webhook.setSigningSecret", Primitive.action(webhooks.setSigningSecret))
      .handle("webhook.revealSigningSecret", Primitive.action(webhooks.revealSigningSecret))
  }),
)

export const WebhookDeliveryHandler = HttpApiBuilder.group(Api, "webhook-delivery", (handlers) =>
  Effect.gen(function* () {
    const webhooks = yield* Webhooks.Service
    return handlers.handle("webhook-delivery.list", Primitive.list(webhooks.deliveries))
  }),
)

export const WebhookParserHandler = HttpApiBuilder.group(Api, "webhook-parser", (handlers) =>
  Effect.gen(function* () {
    const webhooks = yield* Webhooks.Service
    return handlers
      .handle("webhook-delivery.test", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => webhooks.test(actor, request.payload)).pipe(
          Effect.catchTag("Primitive.NotFound", Primitive.notFound),
        ),
      )
      .handle("webhook-delivery.replay", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => webhooks.replay(actor, request.payload)).pipe(
          Effect.catchTags({
            "Primitive.NotFound": Primitive.notFound,
            "Primitive.Forbidden": Primitive.forbidden,
            "Primitive.Conflict": Primitive.conflict,
          }),
        ),
      )
  }),
)
