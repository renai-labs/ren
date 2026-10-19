export * as SessionEvent from "./session-event.js"

import { Schema } from "effect"
import { Form } from "./form.js"
import { Permission } from "./permission.js"
import { Session } from "./session.js"
import { SessionError } from "./session-error.js"
import { SessionInbox } from "./session-inbox.js"
import { SessionInfo } from "./session-info.js"
import { SessionMessage } from "./session-message.js"
import { SessionModel } from "./session-model.js"
import { Shell } from "./shell.js"

const define = <const Type extends string, const Fields extends Schema.Struct.Fields>(type: Type, fields: Fields) =>
  Schema.Struct({
    id: Schema.String,
    created: Schema.Finite,
    type: Schema.Literal(type),
    data: Schema.Struct(fields),
  }).annotate({ identifier: `SessionEvent.${type}` })

const base = { sessionID: Session.ID }
const step = { ...base, assistantMessageID: SessionMessage.ID }
const part = { ...step, ordinal: Schema.Int }
const tool = { ...step, id: Schema.String }
const inbox = { ...base, inboxID: SessionMessage.ID }

export interface ShellRun extends Schema.Schema.Type<typeof ShellRun> {}
export const ShellRun = Schema.Struct({
  id: Schema.String,
  status: SessionMessage.ShellStatus,
  command: Schema.String,
  exit: Schema.optionalKey(Schema.Finite),
  time: Schema.Struct({ started: Schema.Finite, completed: Schema.optionalKey(Schema.Finite) }),
}).annotate({ identifier: "SessionEvent.Shell" })

const usage = {
  cost: Schema.optionalKey(Schema.Finite),
  tokens: Schema.optionalKey(SessionMessage.TokenUsage),
}

export const Connected = define("server.connected", {})
export const Heartbeat = define("server.heartbeat", {})
export const Ended = define("stream.ended", { reason: Schema.Literals(["idle", "closing"]) })

export const Created = define("session.created", {
  ...base,
  parentID: Schema.optionalKey(Session.ID),
  title: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(SessionModel.Ref),
})
export const AgentSelected = define("session.agent.selected", {
  ...base,
  agent: Schema.String,
  previous: Schema.optionalKey(Schema.String),
})
export const ModelSelected = define("session.model.selected", {
  ...base,
  model: SessionModel.Ref,
  previous: Schema.optionalKey(SessionModel.Ref),
})
export const Renamed = define("session.renamed", { ...base, title: Schema.String })
export const UsageUpdated = define("session.usage.updated", {
  ...base,
  cost: Schema.Finite,
  tokens: SessionMessage.TokenUsage,
})
export const Deleted = define("session.deleted", base)

export const InboxEnqueued = define("session.inbox.enqueued", { ...inbox, item: SessionInbox.Item })
export const InboxDelivered = define("session.inbox.delivered", inbox)
export const InboxCancelled = define("session.inbox.cancelled", inbox)
export const InboxDeliveryChanged = define("session.inbox.delivery.changed", {
  ...inbox,
  delivery: SessionInbox.Delivery,
})

export const ExecutionStarted = define("session.execution.started", base)
export const ExecutionSucceeded = define("session.execution.succeeded", base)
export const ExecutionFailed = define("session.execution.failed", { ...base, error: SessionError.Info })
export const ExecutionInterrupted = define("session.execution.interrupted", {
  ...base,
  reason: Schema.Literals(["user", "shutdown", "superseded", "inactivity"]),
})

export const Synthetic = define("session.synthetic", {
  ...base,
  text: Schema.String,
  description: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(SessionMessage.SyntheticMetadata),
})
export const SkillActivated = define("session.skill.activated", {
  ...base,
  id: Schema.String,
  name: Schema.String,
  text: Schema.String,
})
export const ShellStarted = define("session.shell.started", { ...base, shell: ShellRun })
export const ShellEnded = define("session.shell.ended", {
  ...base,
  shell: ShellRun,
  output: SessionMessage.ShellOutput,
})

export const StepStarted = define("session.step.started", {
  ...step,
  agent: Schema.String,
  model: SessionModel.Ref,
  snapshot: Schema.optionalKey(Schema.String),
  started: Schema.Finite,
})
export const StepStreamed = define("session.step.streamed", step)
export const StepEnded = define("session.step.ended", {
  ...step,
  finish: SessionMessage.FinishReason,
  cost: Schema.Finite,
  tokens: SessionMessage.TokenUsage,
  snapshot: Schema.optionalKey(Schema.String),
  files: Schema.optionalKey(Schema.Array(Schema.String)),
})
export const StepFailed = define("session.step.failed", {
  ...step,
  ...usage,
  error: SessionError.Info,
  finish: Schema.optionalKey(Schema.Literal("content-filter")),
  snapshot: Schema.optionalKey(Schema.String),
  files: Schema.optionalKey(Schema.Array(Schema.String)),
})

export const TextStarted = define("session.text.started", part)
export const TextDelta = define("session.text.delta", { ...part, delta: Schema.String })
export const TextEnded = define("session.text.ended", { ...part, text: Schema.String })
export const ReasoningStarted = define("session.reasoning.started", part)
export const ReasoningDelta = define("session.reasoning.delta", { ...part, delta: Schema.String })
export const ReasoningEnded = define("session.reasoning.ended", { ...part, text: Schema.String })

export const ToolInputStarted = define("session.tool.input.started", { ...tool, name: Schema.String })
export const ToolInputDelta = define("session.tool.input.delta", { ...tool, delta: Schema.String })
export const ToolInputEnded = define("session.tool.input.ended", { ...tool, text: Schema.String })
export const ToolCalled = define("session.tool.called", {
  ...tool,
  input: SessionMessage.Json,
  executed: Schema.Boolean,
})
export const ToolProgress = define("session.tool.progress", { ...tool, metadata: SessionMessage.Json })
export const ToolSuccess = define("session.tool.success", {
  ...tool,
  content: Schema.NonEmptyArray(SessionMessage.ToolContent),
  metadata: Schema.optionalKey(SessionMessage.Json),
  executed: Schema.Boolean,
})
export const ToolFailed = define("session.tool.failed", {
  ...tool,
  error: SessionError.Info,
  content: Schema.optionalKey(Schema.NonEmptyArray(SessionMessage.ToolContent)),
  metadata: Schema.optionalKey(SessionMessage.Json),
  executed: Schema.Boolean,
})

export const RetryScheduled = define("session.retry.scheduled", {
  ...step,
  attempt: Schema.Int,
  at: Schema.Finite,
  error: SessionError.Info,
})

export const CompactionStarted = define("session.compaction.started", {
  ...base,
  reason: SessionMessage.CompactionReason,
  recent: Schema.String,
  inputID: Schema.optionalKey(SessionMessage.ID),
})
export const CompactionDelta = define("session.compaction.delta", { ...base, text: Schema.String })
export const CompactionEnded = define("session.compaction.ended", {
  ...base,
  ...usage,
  reason: SessionMessage.CompactionReason,
  model: Schema.optionalKey(SessionModel.Ref),
  text: Schema.String,
  recent: Schema.String,
})
export const CompactionFailed = define("session.compaction.failed", {
  ...base,
  ...usage,
  reason: SessionMessage.CompactionReason,
  error: SessionError.Info,
  inputID: Schema.optionalKey(SessionMessage.ID),
})

export const RevertStaged = define("session.revert.staged", { ...base, revert: SessionInfo.Revert })
export const RevertCleared = define("session.revert.cleared", base)
export const RevertCommitted = define("session.revert.committed", { ...base, to: SessionMessage.ID })

export const PermissionAsked = define("permission.asked", Permission.Request.fields)
export const PermissionReplied = define("permission.replied", {
  ...base,
  requestID: Permission.RequestID,
  reply: Permission.Reply,
})

export const FormCreated = define("form.created", { form: Form.Info })
export const FormReplied = define("form.replied", { id: Form.ID, sessionID: Schema.String, answer: Form.Answer })
export const FormCancelled = define("form.cancelled", { id: Form.ID, sessionID: Schema.String })

export const ShellCreated = define("shell.created", { info: Shell.Info })
export const ShellExited = define("shell.exited", {
  id: Shell.ID,
  exit: Schema.optionalKey(Schema.Finite),
  status: SessionMessage.ShellStatus,
})
export const ShellDeleted = define("shell.deleted", { id: Shell.ID })

export const definitions = [
  Created,
  AgentSelected,
  ModelSelected,
  Renamed,
  UsageUpdated,
  Deleted,
  InboxEnqueued,
  InboxDelivered,
  InboxCancelled,
  InboxDeliveryChanged,
  ExecutionStarted,
  ExecutionSucceeded,
  ExecutionFailed,
  ExecutionInterrupted,
  Synthetic,
  SkillActivated,
  ShellStarted,
  ShellEnded,
  StepStarted,
  StepStreamed,
  StepEnded,
  StepFailed,
  TextStarted,
  TextDelta,
  TextEnded,
  ReasoningStarted,
  ReasoningDelta,
  ReasoningEnded,
  ToolInputStarted,
  ToolInputDelta,
  ToolInputEnded,
  ToolCalled,
  ToolProgress,
  ToolSuccess,
  ToolFailed,
  RetryScheduled,
  CompactionStarted,
  CompactionDelta,
  CompactionEnded,
  CompactionFailed,
  RevertStaged,
  RevertCleared,
  RevertCommitted,
  PermissionAsked,
  PermissionReplied,
  FormCreated,
  FormReplied,
  FormCancelled,
  ShellCreated,
  ShellExited,
  ShellDeleted,
] as const

export const Event = Schema.Union(definitions).annotate({ identifier: "SessionEvent.Event" })
export type Event = typeof Event.Type
export type Type = Event["type"]

export const types: ReadonlySet<string> = new Set(definitions.map((definition) => definition.fields.type.literal))

export const Frame = Schema.Union([Connected, Heartbeat, Ended, Event]).annotate({ identifier: "SessionEvent.Frame" })
export type Frame = typeof Frame.Type
