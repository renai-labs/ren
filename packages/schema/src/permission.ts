export * as Permission from "./permission.js"

import { Schema } from "effect"

export const RuleEffect = Schema.Literals(["ask", "deny"]).annotate({ identifier: "Permission.RuleEffect" })
export type RuleEffect = typeof RuleEffect.Type

export interface Rule extends Schema.Schema.Type<typeof Rule> {}
export const Rule = Schema.Struct({
  action: Schema.NonEmptyString,
  resource: Schema.NonEmptyString,
  effect: RuleEffect,
}).annotate({ identifier: "Permission.Rule" })

export const RuleList = Schema.Array(Rule).annotate({ identifier: "Permission.RuleList" })
export type RuleList = typeof RuleList.Type
