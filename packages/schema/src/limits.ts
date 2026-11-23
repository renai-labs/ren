export * as Limits from "./limits.js"

import { Schema } from "effect"

const Percent = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
  description: "How much of the limit is used, in whole percent. Above 100 when the meter went over.",
})

const Key = Schema.String.annotate({
  description: "The meter. A banner step shows once per chat, key and `resetsAt`.",
})

export interface Seat extends Schema.Schema.Type<typeof Seat> {}
export const Seat = Schema.TaggedStruct("seat", {
  key: Key,
  percent: Percent,
  resetsAt: Schema.NullOr(Schema.DateTimeUtc),
  seat: Schema.String.annotate({ description: "Who connected the seat and its plan, such as “Asha’s Max”." }),
  providerName: Schema.String.annotate({ description: "The card of the seat, such as Anthropic." }),
  window: Schema.String.annotate({ description: "The vendor’s window, such as `5h` or `7d`." }),
  title: Schema.String.annotate({ description: "The gateway’s name of the window." }),
}).annotate({
  identifier: "Limits.Seat",
  description: "One window of the subscription that served the chat’s last seat call.",
})

export interface Credit extends Schema.Schema.Type<typeof Credit> {}
export const Credit = Schema.TaggedStruct("credit", {
  key: Key,
  percent: Percent,
  resetsAt: Schema.NullOr(Schema.DateTimeUtc).annotate({ description: "The next billing date." }),
  availableMicroUsd: Schema.Int.annotate({ description: "The credit left, in millionths of a US dollar." }),
}).annotate({ identifier: "Limits.Credit", description: "The organization’s Ren credit: used ÷ granted." })

export interface Free extends Schema.Schema.Type<typeof Free> {}
export const Free = Schema.TaggedStruct("free", {
  key: Key,
  percent: Percent,
  resetsAt: Schema.DateTimeUtc.annotate({ description: "00:00 UTC of the next day." }),
  used: Schema.Int,
  limit: Schema.Int,
}).annotate({ identifier: "Limits.Free", description: "Today’s free-model requests of the organization." })

export const Meter = Schema.Union([Seat, Credit, Free]).annotate({ identifier: "Limits.Meter" })
export type Meter = typeof Meter.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  meters: Schema.Array(Meter),
}).annotate({
  identifier: "Limits.Info",
  description:
    "The meters of the chat’s current model: the windows of the seat that served the chat’s last seat call, Ren credit, or the free cap. Empty for a model on the organization’s own key, a ChatGPT seat, or when a source does not answer.",
})
