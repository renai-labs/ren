export * as Env from "./env.js"

import { SessionToken } from "@ren/brain-api/session-token"
import { Effect, Schema } from "effect"

const Millis = (fallback: number) =>
  Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefault(Effect.succeed(String(fallback))),
  )

export interface Vars extends Schema.Schema.Type<typeof Vars> {}
export const Vars = Schema.Struct({
  CELL_KEYS: SessionToken.Keys,
  ALARM_INTERVAL_MS: Millis(30_000),
  WAIT_BUDGET_MS: Millis(600_000),
  PARK_AFTER_MS: Millis(600_000),
  CHAT_IDLE_MS: Millis(120_000),
  CHAT_HEARTBEAT_MS: Millis(15_000),
  OPENCODE_CONFIG: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("{}"))),
  REN_URL: Schema.optional(Schema.String),
})
