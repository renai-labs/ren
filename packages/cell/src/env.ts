export * as Env from "./env.js"

import { Effect, Schema } from "effect"

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const Key = Schema.Struct({
  id: Schema.NonEmptyString,
  secret: Schema.String.check(Schema.isMinLength(32)),
})

const Millis = (fallback: number) =>
  Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefault(Effect.succeed(String(fallback))),
  )

export interface Vars extends Schema.Schema.Type<typeof Vars> {}
export const Vars = Schema.Struct({
  CELL_KEYS: Schema.fromJsonString(
    Schema.NonEmptyArray(Key).check(
      Schema.makeFilter((keys) => new Set(keys.map((key) => key.id)).size === keys.length || "key ids must be unique"),
    ),
  ),
  ALARM_INTERVAL_MS: Millis(30_000),
  WAIT_BUDGET_MS: Millis(600_000),
})
