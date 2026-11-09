export * as Env from "./env.js"

import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { Effect, Schema, SchemaGetter } from "effect"

const OpenCodeConfig = Schema.fromJsonString(
  Schema.StructWithRest(Schema.Struct({ plugins: Schema.optional(Schema.Array(Schema.Unknown)) }), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]),
)

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
  OPENCODE_CONFIG: OpenCodeConfig.pipe(
    Schema.decode({
      decode: SchemaGetter.transform((config) => ({
        ...config,
        plugins: [...(config.plugins ?? []), "-opencode.plan"],
      })),
      encode: SchemaGetter.passthrough(),
    }),
    Schema.decodeTo(Schema.flip(OpenCodeConfig)),
    Schema.withDecodingDefault(Effect.succeed("{}")),
  ).annotate({
    description:
      "OpenCode’s config as JSON. Ren removes OpenCode’s Plan plugin, which puts any agent named plan in read-only Plan mode.",
  }),
  REN_URL: Schema.optional(Schema.String),
  REN_EGRESS: Schema.optional(Schema.Literal("1")).annotate({
    description: "The brain runs behind Ren’s egress: it holds no host token and keeps REN_URL (C8, C49).",
  }),
  REN_HAND_PLACEMENT: Schema.optional(Schema.Literal("remote")).annotate({
    description:
      "The space’s chats run their tools on another machine: OpenCode’s saved tool output, workspace panel files and git go to that machine (EN13).",
  }),
  REN_BRAIN_VERSION: Schema.optional(Schema.String),
  REN_TOOLS_MEMORY_EVENTS: Schema.optional(Schema.String).annotate({
    description:
      "The memory.events file of the group that caps the tools’ memory. Without it, the brain counts no tools that the sandbox stops.",
  }),
})
