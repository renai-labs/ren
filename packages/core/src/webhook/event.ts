export * as WebhookEvent from "./event.js"

import { Webhook } from "@ren/schema/webhook"
import { Schema } from "effect"

export const Request = Schema.Struct({
  _tag: Schema.Literal("request"),
  webhookId: Webhook.ID,
  requestId: Webhook.RequestID,
  replays: Schema.Int,
  threadKey: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "WebhookEvent.Request" })
export type Request = typeof Request.Type

export const Repair = Schema.Struct({
  _tag: Schema.Literal("repair"),
  webhookId: Webhook.ID,
  updatedAt: Schema.String,
}).annotate({ identifier: "WebhookEvent.Repair" })

export const Event = Schema.Union([Request, Repair]).annotate({ identifier: "WebhookEvent.Event" })
export type Event = typeof Event.Type

export const keyOf = (event: Event) =>
  event._tag === "repair"
    ? { originId: event.webhookId, eventId: `repair:${event.updatedAt}` }
    : {
        originId: event.webhookId,
        eventId: event.replays > 0 ? `${event.requestId}:replay-${event.replays}` : event.requestId,
        ...(event.threadKey && { threadKey: event.threadKey }),
      }
