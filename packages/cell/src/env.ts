export * as Env from "./env.js"

import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { Effect, Schema } from "effect"

const Millis = (fallback: number) =>
  Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefault(Effect.succeed(String(fallback))),
  )

export interface Vars extends Schema.Schema.Type<typeof Vars> {}
export const Vars = Schema.Struct({
  BRAIN_PUBLIC_KEYS: Signature.PublicKeys,
  REN_BRAIN_ID: Schema.optional(Brain.ID),
  REN_BRAIN_GENERATION: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefault(Effect.succeed("1")),
  ),
  ALARM_INTERVAL_MS: Millis(30_000),
  PULL_INTERVAL_MS: Millis(30_000),
  WAIT_BUDGET_MS: Millis(600_000),
  PARK_AFTER_MS: Millis(600_000),
  CHAT_IDLE_MS: Millis(120_000),
  CHAT_HEARTBEAT_MS: Millis(15_000),
  OPENCODE_CONFIG: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("{}"))),
  REN_URL: Schema.optional(Schema.String),
})
