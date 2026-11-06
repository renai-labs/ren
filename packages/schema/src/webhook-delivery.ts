export * as WebhookDelivery from "./webhook-delivery.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Session } from "./session.js"
import { Webhook } from "./webhook.js"

export const ID = Identifier.make("whd", "WebhookDelivery.ID")
export type ID = typeof ID.Type

export const Outcome = Schema.Literals([
  "recorded",
  "throttled",
  "answered",
  "started",
  "continued",
  "ignored",
  "duplicate",
  "rejected",
  "failed",
]).annotate({
  identifier: "WebhookDelivery.Outcome",
  description:
    "`recorded`: the webhook was listening. `throttled`: over 60 requests a minute. `answered`: a handshake. `started` or `continued`: a chat. `ignored`: the filter was false or broke. `duplicate`: an earlier request had its event ID. `rejected`: the signature was wrong, or the body too large. `failed`: the chat did not start.",
})
export type Outcome = typeof Outcome.Type

export const retentionDays = 30

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  webhookId: Webhook.ID,
  receivedAt: Schema.DateTimeUtc,
  outcome: Outcome,
  broken: Schema.Boolean.annotate({ description: "A CEL expression of the parser ended in an error." }),
  reason: Schema.NullOr(Schema.String).annotate({ description: "Why the outcome, such as `filter: no such key`." }),
  verified: Schema.Boolean.annotate({ description: "False for a request recorded before the signing secret was set." }),
  eventId: Schema.NullOr(Schema.String),
  threadKey: Schema.NullOr(Schema.String),
  sessionId: Schema.NullOr(Session.ID).annotate({ description: "The chat that it started or continued." }),
  method: Schema.String,
  query: Schema.Record(Schema.String, Schema.String),
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.NullOr(Schema.String).annotate({ description: "Null for a rejected request." }),
}).annotate({ identifier: "WebhookDelivery.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  webhookId: Webhook.ID,
  outcome: Schema.optional(Outcome),
  ...Pagination.fields(20),
}).annotate({
  identifier: "WebhookDelivery.ListInput",
  description: "The requests that reached one webhook in the last 30 days, newest first.",
})

const Page = Pagination.Page(Info).annotate({ identifier: "WebhookDelivery.Page" })

export interface Tested extends Schema.Schema.Type<typeof Tested> {}
export const Tested = Schema.Struct({
  deliveryId: ID,
  outcome: Schema.Literals(["answered", "started", "continued", "ignored", "duplicate", "rejected"]),
  broken: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
  eventId: Schema.NullOr(Schema.String),
  threadKey: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
}).annotate({
  identifier: "WebhookDelivery.Tested",
  description: "What the parser would do with one recorded request.",
})

export interface TestInput extends Schema.Schema.Type<typeof TestInput> {}
export const TestInput = Schema.Struct({
  webhookId: Webhook.ID,
  parser: Schema.optional(Webhook.Parser).annotate({ description: "Without it, the parser of the webhook." }),
  deliveryIds: Schema.optional(Schema.Array(ID)).annotate({ description: "Without it, the last 20 requests." }),
}).annotate({ identifier: "WebhookDelivery.TestInput" })

export interface TestResult extends Schema.Schema.Type<typeof TestResult> {}
export const TestResult = Schema.Struct({ items: Schema.Array(Tested) }).annotate({
  identifier: "WebhookDelivery.TestResult",
})

export interface ReplayInput extends Schema.Schema.Type<typeof ReplayInput> {}
export const ReplayInput = Schema.Struct({ webhookId: Webhook.ID }).annotate({
  identifier: "WebhookDelivery.ReplayInput",
  description: "Runs the current parser on the recorded and throttled requests and starts their chats.",
})

export interface Replayed extends Schema.Schema.Type<typeof Replayed> {}
export const Replayed = Schema.Struct({ replayed: Schema.Int }).annotate({ identifier: "WebhookDelivery.Replayed" })

export const definition = Primitive.define({
  name: "webhook-delivery",
  plural: "webhook-deliveries",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
})
