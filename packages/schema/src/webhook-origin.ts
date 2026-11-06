export * as WebhookOrigin from "./webhook-origin.js"

import { Schema } from "effect"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  webhookId: Schema.String,
  name: Schema.String,
  deliveryId: Schema.String.annotate({ description: "The request in Ren, not the event ID of the provider." }),
  receivedAt: Schema.String.annotate({ description: "When Ren received the request, as an ISO 8601 instant." }),
}).annotate({
  identifier: "WebhookOrigin.Info",
  description: "The webhook that sent a message, and the request that it came from.",
})
