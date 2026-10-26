export * as Channel from "./channel.js"

import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"
import { ChannelOrigin } from "./channel-origin.js"
import { Identifier } from "./identifier.js"

export const Provider = ChannelOrigin.Provider
export type Provider = ChannelOrigin.Provider

export const titles: Readonly<Record<Provider, string>> = { slack: "Slack", linear: "Linear", github: "GitHub" }

export const ThreadID = Identifier.make("cth", "Channel.ThreadID")
export type ThreadID = typeof ThreadID.Type


export interface FileRef extends Schema.Schema.Type<typeof FileRef> {}
export const FileRef = Schema.Struct({
  url: Schema.String,
  name: Schema.String,
  mime: Schema.String,
  size: Schema.optionalKey(Schema.Int),
}).annotate({ identifier: "Channel.FileRef" })

export interface Event extends Schema.Schema.Type<typeof Event> {}
export const Event = Schema.Struct({
  provider: Provider,
  eventId: Schema.NonEmptyString.annotate({ description: "The provider’s id of this delivery." }),
  install: Schema.NonEmptyString.annotate({
    description: "The provider’s workspace id: Slack team, Linear organization, GitHub installation.",
  }),
  place: Schema.Struct({
    id: Schema.NonEmptyString,
    kind: Schema.Literals(["channel", "dm", "project", "repository"]),
    name: Schema.optionalKey(Schema.String),
  }),
  thread: Schema.Struct({ id: Schema.NonEmptyString, url: Schema.optionalKey(Schema.String) }),
  message: Schema.NonEmptyString.annotate({
    description: "The provider’s id of the message: a Slack ts, a Linear activity, a GitHub comment.",
  }),
  sender: Schema.Struct({
    accountId: Schema.NonEmptyString,
    name: Schema.optionalKey(Schema.String),
    handle: Schema.optionalKey(Schema.String),
  }),
  text: Schema.String,
  files: Schema.Array(FileRef),
}).annotate({ identifier: "Channel.Event" })

export const Parsed = Schema.Union([
  Schema.TaggedStruct("Handshake", { body: Schema.Json }),
  Schema.TaggedStruct("Ignore", { reason: Schema.String }),
  Schema.TaggedStruct("Event", { event: Event }),
  Schema.TaggedStruct("Uninstalled", { install: Schema.NonEmptyString }),
]).annotate({ identifier: "Channel.Parsed" })
export type Parsed = typeof Parsed.Type

export interface ReplyInput extends Schema.Schema.Type<typeof ReplyInput> {}
export const ReplyInput = Schema.Struct({
  text: Schema.NonEmptyString.annotate({ description: "The answer, in Markdown. Ren posts it in the thread as is." }),
}).annotate({ identifier: "Channel.ReplyInput" })

export interface Sent extends Schema.Schema.Type<typeof Sent> {}
export const Sent = Schema.Struct({
  provider: Provider,
  place: Schema.String.annotate({ description: "The channel, project or repository that the reply went to." }),
}).annotate({ identifier: "Channel.Sent" })

export const FailureReason = Schema.Literals([
  "unlinked",
  "not_member",
  "fallback_gone",
  "brain_failed",
  "model_busy",
  "context_too_long",
  "unknown",
]).annotate({ identifier: "Channel.FailureReason" })
export type FailureReason = typeof FailureReason.Type

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
