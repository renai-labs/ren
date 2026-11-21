export * as SessionUsage from "./usage.js"

import { Schema } from "effect"

const Micro = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Source = Schema.Literals(["provider", "billed"]).annotate({ identifier: "SessionUsage.Source" })
export type Source = typeof Source.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  total: Micro,
  models: Micro,
  tools: Micro,
  currency: Schema.Literal("usd"),
  source: Source.annotate({
    description: "`provider` is what the provider charged Ren. `billed` is the price Ren charged the organization.",
  }),
}).annotate({
  identifier: "SessionUsage.Info",
  description:
    "What a chat cost, in millionths of a US dollar. It counts the chat and its subagents, and leaves out events that the organization paid with its own key or subscription.",
})
