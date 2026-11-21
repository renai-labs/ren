export * as UsageSearch from "./usage-search.js"

import { Schema } from "effect"
import { Insights } from "../../lib/insights.js"

export const Breakdown = Schema.Literals(["space", "member", "agent", "model"])
export type Breakdown = typeof Breakdown.Type

export const Search = Schema.Struct({
  period: Schema.optional(Insights.Period),
  space: Schema.optional(Schema.String),
  member: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
})
export type Search = typeof Search.Type

export type Change = (next: Partial<Search>) => void
