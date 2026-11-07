export * as WebhookRequest from "./webhook-request.js"

import { Schema } from "effect"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Session } from "./session.js"
import { Webhook } from "./webhook.js"

export const ID = Webhook.RequestID
export type ID = Webhook.RequestID

export const Outcome = Webhook.RequestOutcome
export type Outcome = Webhook.RequestOutcome

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
  bodyBytes: Schema.NullOr(Schema.Int).annotate({ description: "Null for a rejected request, which keeps no body." }),
}).annotate({ identifier: "WebhookRequest.Info" })

export interface Detail extends Schema.Schema.Type<typeof Detail> {}
export const Detail = Schema.Struct({
  ...Info.fields,
  query: Schema.Record(Schema.String, Schema.String),
  headers: Schema.Record(Schema.String, Schema.String).annotate({
    description: "Lowercase names. The values of authorization, cookie and the signature header are [hidden].",
  }),
  body: Schema.NullOr(Schema.String).annotate({ description: "Null for a rejected request." }),
}).annotate({ identifier: "WebhookRequest.Detail" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  webhookId: Webhook.ID,
  outcome: Schema.optional(Outcome),
  ...Pagination.fields(20),
}).annotate({
  identifier: "WebhookRequest.ListInput",
  description: "The requests that reached one webhook in the last 30 days, newest first, without headers or body.",
})

const Page = Pagination.Page(Info).annotate({ identifier: "WebhookRequest.Page" })

const NoInput = Schema.Struct({}).annotate({ identifier: "WebhookRequest.NoInput" })

export const definition = Primitive.define({
  name: "webhook-request",
  plural: "webhook-requests",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  actions: {
    get: { input: NoInput, result: Detail },
  },
})
