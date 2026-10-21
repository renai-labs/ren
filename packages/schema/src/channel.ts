export * as Channel from "./channel.js"

import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"

const fields = {
  purpose: Schema.NonEmptyString,
  agent: Schema.optionalKey(Agent.Name.annotate({ description: "Without it, the channel reaches the ren agent." })),
}

export const Declaration = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("slack"), ...fields }),
  Schema.Struct({ kind: Schema.Literal("linear"), ...fields }),
  Schema.Struct({ kind: Schema.Literal("email"), ...fields }),
  Schema.Struct({
    kind: Schema.Literal("github"),
    ...fields,
    prListener: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
    prListenerPrompt: Schema.optionalKey(Schema.NonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("telegram"),
    ...fields,
    allowedSenders: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
    blockedSenders: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  }),
]).annotate({ identifier: "Channel.Declaration" })
export type Declaration = typeof Declaration.Type

export const Target = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("slack"), channelId: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("linear"), projectId: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("github"), repository: Schema.NonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal("telegram"),
    chatId: Schema.NonEmptyString,
    topicId: Schema.optionalKey(Schema.NonEmptyString),
  }),
]).annotate({ identifier: "Channel.Target" })
export type Target = typeof Target.Type
