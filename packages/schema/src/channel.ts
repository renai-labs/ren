export * as Channel from "./channel.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { ChannelOrigin } from "./channel-origin.js"
import { Identifier } from "./identifier.js"
import { Task } from "./task.js"
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

const Sender = Schema.Struct({
  accountId: Schema.NonEmptyString,
  name: Schema.optionalKey(Schema.String),
  handle: Schema.optionalKey(Schema.String),
})

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
  sender: Sender,
  text: Schema.String,
  files: Schema.Array(FileRef),
  trigger: Schema.optionalKey(TriggerID).annotate({
    description:
      "Set when nobody mentioned Ren. Only a mapping with this trigger on answers, with its prompt in place of the text.",
  }),
}).annotate({ identifier: "Channel.Event" })

export const CardAction = Schema.Literals([
  "approve",
  "start",
  "request_review",
  "done",
  "dismiss",
  "assign_to_me",
]).annotate({ identifier: "Channel.CardAction", description: "A button on a task card that changes the task." })
export type CardAction = typeof CardAction.Type

const SignalLink = Schema.Struct({
  kind: TaskLink.Kind,
  key: Schema.String.annotate({ description: "The canonical key of the linked item, such as acme/web#41." }),
})

export const Signal = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("pull_request_merged"),
    install: Schema.NonEmptyString,
    link: SignalLink,
    url: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("mentioned"),
    install: Schema.NonEmptyString,
    link: SignalLink,
    url: Schema.String,
    sender: Sender.annotate({ description: "Who opened or edited the item." }),
    text: Schema.String.annotate({ description: "The text that can name tasks, such as a branch, title and body." }),
  }),
  Schema.Struct({
    kind: Schema.Literal("links_shared"),
    install: Schema.NonEmptyString,
    place: Schema.String.annotate({ description: "The Slack channel, or COMPOSER for a message not yet sent." }),
    message: Schema.String.annotate({ description: "The ts of the message that has the links." }),
    unfurl: Schema.optionalKey(Schema.Struct({ id: Schema.String, source: Schema.String })),
    urls: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("details_requested"),
    install: Schema.NonEmptyString,
    place: Schema.optionalKey(Schema.String).annotate({ description: "The Slack channel of the card, if any." }),
    trigger: Schema.String.annotate({ description: "The trigger_id that opens the details." }),
    url: Schema.String,
    externalId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("card_action"),
    install: Schema.NonEmptyString,
    sender: Sender.annotate({ description: "Who clicked." }),
    taskId: Task.ID,
    action: CardAction,
    responseUrl: Schema.optionalKey(Schema.String).annotate({
      description: "Where a private reply to the person who clicked goes.",
    }),
  }),
]).annotate({
  identifier: "Channel.Signal",
  description: "A provider event that changes or shows tasks and starts no turn.",
})
export type Signal = typeof Signal.Type

export const Parsed = Schema.Union([
  Schema.TaggedStruct("Handshake", { body: Schema.Json }),
  Schema.TaggedStruct("Ignore", { reason: Schema.String }),
  Schema.TaggedStruct("Event", { event: Event, signal: Schema.optionalKey(Signal) }),
  Schema.TaggedStruct("Uninstalled", { install: Schema.NonEmptyString }),
  Schema.TaggedStruct("Signal", { signal: Signal }),
]).annotate({ identifier: "Channel.Parsed" })
export type Parsed = typeof Parsed.Type

const Label = Schema.String.annotate({ description: "At most 20 characters" })

const AxisTitle = Schema.optionalKey(Schema.String.annotate({ description: "At most 50 characters" }))

export const Chart = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pie"),
    title: Schema.String.annotate({ description: "At most 50 characters" }),
    segments: Schema.Array(Schema.Struct({ label: Label, value: Schema.Finite })).annotate({
      description: "1 to 12 slices, each with a value above 0",
    }),
  }),
  Schema.Struct({
    type: Schema.Literals(["bar", "area", "line"]),
    title: Schema.String.annotate({ description: "At most 50 characters" }),
    categories: Schema.Array(Label).annotate({ description: "The x-axis, 1 to 20 categories, in order" }),
    series: Schema.Array(
      Schema.Struct({
        name: Label,
        values: Schema.Array(Schema.Finite).annotate({ description: "One value for each category, in order" }),
      }),
    ).annotate({ description: "1 to 12 series with distinct names" }),
    xLabel: AxisTitle,
    yLabel: AxisTitle,
  }),
]).annotate({ identifier: "Channel.Chart", description: "A native chart that Ren posts under the text." })
export type Chart = typeof Chart.Type

export interface ChartNote extends Schema.Schema.Type<typeof ChartNote> {}
export const ChartNote = Schema.Struct({ title: Schema.String, reason: Schema.String }).annotate({
  identifier: "Channel.ChartNote",
})

export interface ChartReport extends Schema.Schema.Type<typeof ChartReport> {}
export const ChartReport = Schema.Struct({
  sent: Schema.Int.annotate({ description: "The charts that the reply shows." }),
  repaired: Schema.Array(ChartNote).annotate({ description: "Charts that Ren changed to fit Slack, and how." }),
  dropped: Schema.Array(ChartNote).annotate({ description: "Charts that the reply does not show, and why." }),
}).annotate({ identifier: "Channel.ChartReport" })

export interface Sent extends Schema.Schema.Type<typeof Sent> {}
export const Sent = Schema.Struct({
  provider: Provider,
  place: Schema.String.annotate({ description: "The channel, project or repository that the reply went to." }),
  charts: Schema.optionalKey(ChartReport),
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

const mapped = {
  purpose: Schema.NonEmptyString,
  agent: Schema.optionalKey(Agent.Name.annotate({ description: "Without it, the channel reaches the ren agent." })),
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
  Schema.Struct({ kind: Schema.Literal("github"), ...mapped }),
]).annotate({
  identifier: "Channel.Declaration",
  description: "A channel that maps a place to a space. The spec maps the channels that a person installed in Ren.",
})
export type Declaration = typeof Declaration.Type

export const Target = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("slack"), channelId: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("github"), repository: Schema.NonEmptyString }),
]).annotate({ identifier: "Channel.Target" })
export type Target = typeof Target.Type
