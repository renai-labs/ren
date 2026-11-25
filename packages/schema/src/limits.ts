export * as Limits from "./limits.js"

import { Schema } from "effect"

const Percent = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
  description: "How much is used, in whole percent. Above 100 when it went over.",
})

const Key = Schema.String.annotate({
  description: "Which limit. A banner step shows once per chat, key and `resetsAt`.",
})

export interface Seat extends Schema.Schema.Type<typeof Seat> {}
export const Seat = Schema.TaggedStruct("seat", {
  key: Key,
  percent: Percent,
  resetsAt: Schema.NullOr(Schema.DateTimeUtc),
  seat: Schema.String.annotate({ description: "Who connected the seat and its plan, such as “Asha’s Max”." }),
  providerName: Schema.String.annotate({ description: "The provider of the seat, such as Anthropic." }),
  window: Schema.String.annotate({ description: "The vendor’s window, such as `5h` or `7d`." }),
  title: Schema.String.annotate({ description: "The inference service’s name of the window." }),
}).annotate({
  identifier: "Limits.Seat",
  description: "One window of the seat that served the chat’s last seat call.",
})

export interface Free extends Schema.Schema.Type<typeof Free> {}
export const Free = Schema.TaggedStruct("free", {
  key: Key,
  percent: Percent,
  resetsAt: Schema.DateTimeUtc.annotate({ description: "00:00 UTC of the next day." }),
  used: Schema.Int,
  limit: Schema.Int,
}).annotate({ identifier: "Limits.Free", description: "Today’s free-model requests of the organization." })

export const Limit = Schema.Union([Seat, Free]).annotate({
  identifier: "Limits.Limit",
  description: "A cap the inference service or a vendor enforces, with a reset: a seat’s window or the free cap.",
})
export type Limit = typeof Limit.Type

export interface Credit extends Schema.Schema.Type<typeof Credit> {}
export const Credit = Schema.TaggedStruct("credit", {
  key: Key,
  percent: Percent,
  resetsAt: Schema.NullOr(Schema.DateTimeUtc).annotate({ description: "The next billing date." }),
  availableMicroUsd: Schema.Int.annotate({ description: "The credit left, in millionths of a US dollar." }),
}).annotate({
  identifier: "Limits.Credit",
  description: "The organization’s Ren credit in billing: used ÷ granted. Not a limit.",
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  limits: Schema.Array(Limit),
  credit: Schema.NullOr(Credit).annotate({
    description: "Only for a model that Ren pays for and that is not free, and only when credit was granted.",
  }),
}).annotate({
  identifier: "Limits.Info",
  description:
    "What the chat’s current model uses up: the limits of its inference service and the Ren credit. Empty when a source does not answer.",
})
