export * as Channel from "./channel.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { ChannelOrigin } from "./channel-origin.js"
import { Identifier } from "./identifier.js"
import { TaskLink } from "./task-link.js"

export const Provider = ChannelOrigin.Provider
export type Provider = ChannelOrigin.Provider

export const titles: Readonly<Record<Provider, string>> = { slack: "Slack", linear: "Linear", github: "GitHub" }

export const ThreadID = Identifier.make("cth", "Channel.ThreadID")
export type ThreadID = typeof ThreadID.Type

export const TriggerID = Schema.NonEmptyString.annotate({
  identifier: "Channel.TriggerID",
  description: "A provider’s event that starts a turn with no mention of Ren, such as GitHub’s pull_request_ready.",
})

export interface Trigger extends Schema.Schema.Type<typeof Trigger> {}
export const Trigger = Schema.Struct({
  id: TriggerID,
  title: Schema.String,
  description: Schema.String,
  defaultPrompt: Schema.String,
}).annotate({
  identifier: "Channel.Trigger",
  description: "An event that a mapping can turn on, so that Ren runs a turn with no mention.",
})

export interface TriggerSetting extends Schema.Schema.Type<typeof TriggerSetting> {}
export const TriggerSetting = Schema.Struct({
  id: TriggerID,
  prompt: Schema.optionalKey(Schema.NonEmptyString.annotate({ description: "Without it, the trigger’s default." })),
}).annotate({ identifier: "Channel.TriggerSetting", description: "A trigger that a mapping turned on." })

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
    anyoneCanWrite: Schema.optionalKey(Schema.Boolean).annotate({
      description:
        "Anyone with an account at the provider can write here, such as on a public GitHub repository. Unknown senders are refused here until a mapping turns the fallback on.",
    }),
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
  trigger: Schema.optionalKey(TriggerID).annotate({
    description:
      "Set when nobody mentioned Ren. Only a mapping with this trigger on answers, with its prompt in place of the text.",
  }),
}).annotate({ identifier: "Channel.Event" })

export interface Signal extends Schema.Schema.Type<typeof Signal> {}
export const Signal = Schema.Struct({
  kind: Schema.Literal("pull_request_merged"),
  install: Schema.NonEmptyString,
  link: Schema.Struct({
    kind: TaskLink.Kind,
    key: Schema.String.annotate({ description: "The canonical key of the linked item, such as acme/web#41." }),
  }),
  url: Schema.String,
}).annotate({ identifier: "Channel.Signal", description: "A provider event that changes tasks and starts no turn." })

export const Parsed = Schema.Union([
  Schema.TaggedStruct("Handshake", { body: Schema.Json }),
  Schema.TaggedStruct("Ignore", { reason: Schema.String }),
  Schema.TaggedStruct("Event", { event: Event }),
  Schema.TaggedStruct("Uninstalled", { install: Schema.NonEmptyString }),
  Schema.TaggedStruct("Signal", { signal: Signal }),
]).annotate({ identifier: "Channel.Parsed" })
export type Parsed = typeof Parsed.Type

export interface Sent extends Schema.Schema.Type<typeof Sent> {}
export const Sent = Schema.Struct({
  provider: Provider,
  place: Schema.String.annotate({ description: "The channel, project or repository that the reply went to." }),
}).annotate({ identifier: "Channel.Sent" })

export const FailureReason = Schema.Literals([
  "unlinked",
  "not_member",
  "fallback_gone",
  "no_private_space",
  "brain_failed",
  "model_busy",
  "context_too_long",
  "task_handoff",
  "unknown",
]).annotate({ identifier: "Channel.FailureReason" })
export type FailureReason = typeof FailureReason.Type

const fields = {
  purpose: Schema.NonEmptyString,
  agent: Schema.optionalKey(Agent.Name.annotate({ description: "Without it, the channel reaches the ren agent." })),
}

const mapped = {
  ...fields,
  fallback: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run a sender that Ren cannot match to a space member as the person who applies the spec. On by default, off by default for a public GitHub repository.",
  }),
  triggers: Schema.optionalKey(
    Schema.Record(TriggerID, Schema.Struct({ prompt: Schema.optionalKey(Schema.NonEmptyString) })).annotate({
      description: "The provider’s triggers to turn on, such as GitHub’s pull_request_ready. All are off by default.",
    }),
  ),
}

export const Declaration = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("slack"), ...mapped }),
  Schema.Struct({ kind: Schema.Literal("linear"), ...mapped }),
  Schema.Struct({ kind: Schema.Literal("email"), ...fields }),
  Schema.Struct({ kind: Schema.Literal("github"), ...mapped }),
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
