import { Webhook } from "@ren/schema/webhook"
import { WebhookRequest } from "@ren/schema/webhook-request"
import { OpenApi } from "effect/http-api"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

const secret =
  "W18: only settings sets or shows the signing secret, so the model never sees a value that proves the sender."

export const WebhookGroup = Primitive.group(Webhook.definition, "sdk", [
  Primitive.list(Webhook.definition),
  Primitive.get(Webhook.definition),
  Primitive.create(Webhook.definition).annotateMerge(
    OpenApi.annotations({
      description:
        "Create a webhook in a space. It starts in debug mode (`listening`): Ren records requests and starts no session. Then: 1. Give the URL to the user. 2. If the provider signs its requests, set the signature check. The user pastes the provider’s secret in the Ren app, because no tool sets secrets. 3. After a real request arrives, check the parser with `webhook_test`. 4. Make it live with `webhook_update`.",
    }),
  ),
  Primitive.update(Webhook.definition),
  Primitive.archive(Webhook.definition),
  Primitive.action(Webhook.definition, "rotateUrl"),
  Primitive.action(Webhook.definition, "setSigningSecret").annotate(Mcp.Hidden, secret),
  Primitive.action(Webhook.definition, "revealSigningSecret").annotate(Mcp.Hidden, secret),
  Primitive.action(Webhook.definition, "test").annotateMerge(
    OpenApi.annotations({
      description:
        "Run a parser on recorded requests, and show which ones start a session, which are ignored and which break. Use it before you make a webhook live.",
    }),
  ),
  Primitive.action(Webhook.definition, "replay").annotateMerge(
    OpenApi.annotations({
      description: "Send the requests that were recorded in debug mode to their sessions. The webhook must be live.",
    }),
  ),
])

export const WebhookRequestGroup = Primitive.group(WebhookRequest.definition, "sdk", [
  Primitive.list(WebhookRequest.definition).annotateMerge(
    OpenApi.annotations({
      description: "List the requests that a webhook received, newest first, without their bodies.",
    }),
  ),
  Primitive.action(WebhookRequest.definition, "get").annotateMerge(
    OpenApi.annotations({
      description: "Get one request with its headers and body. Use it to find the paths for the parser.",
    }),
  ),
])
