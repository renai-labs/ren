import { Webhook } from "@ren/schema/webhook"
import { Mcp } from "../mcp.js"
import { Primitive } from "../primitive.js"

const secret =
  "W18: only settings sets or shows the signing secret, so the model never sees a value that proves the sender."

export const WebhookGroup = Primitive.group(Webhook.definition, "sdk", [
  Primitive.list(Webhook.definition),
  Primitive.get(Webhook.definition),
  Primitive.create(Webhook.definition),
  Primitive.update(Webhook.definition),
  Primitive.archive(Webhook.definition),
  Primitive.action(Webhook.definition, "rotateUrl"),
  Primitive.action(Webhook.definition, "setSigningSecret").annotate(Mcp.Hidden, secret),
  Primitive.action(Webhook.definition, "revealSigningSecret").annotate(Mcp.Hidden, secret),
])
