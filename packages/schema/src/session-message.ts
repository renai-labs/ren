export * as SessionMessage from "./session-message.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"
import { SessionError } from "./session-error.js"
import { SessionModel } from "./session-model.js"

export const ID = Identifier.makeAscending("msg", "SessionMessage.ID")
export type ID = typeof ID.Type

export const Time = Schema.DateTimeUtcFromMillis

export interface Sender extends Schema.Schema.Type<typeof Sender> {}
export const Sender = Schema.Struct({ userId: Schema.String }).annotate({ identifier: "SessionMessage.Sender" })

export interface TokenUsage extends Schema.Schema.Type<typeof TokenUsage> {}
export const TokenUsage = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  reasoning: Schema.Finite,
  cache: Schema.Struct({ read: Schema.Finite, write: Schema.Finite }),
}).annotate({ identifier: "SessionMessage.TokenUsage" })

export const FinishReason = Schema.Literals(["stop", "length", "tool-calls", "content-filter", "error", "unknown"])
export type FinishReason = typeof FinishReason.Type

export interface Mention extends Schema.Schema.Type<typeof Mention> {}
export const Mention = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  text: Schema.String,
}).annotate({ identifier: "SessionMessage.Mention" })

export const FileSource = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inline") }),
  Schema.Struct({ type: Schema.Literal("uri"), uri: Schema.String }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionMessage.FileSource" })
export type FileSource = typeof FileSource.Type

export interface FileAttachment extends Schema.Schema.Type<typeof FileAttachment> {}
export const FileAttachment = Schema.Struct({
  data: Schema.String,
  mime: Schema.String,
  source: FileSource,
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  mention: Schema.optionalKey(Mention),
}).annotate({ identifier: "SessionMessage.FileAttachment" })

export interface AgentAttachment extends Schema.Schema.Type<typeof AgentAttachment> {}
export const AgentAttachment = Schema.Struct({
  name: Schema.String,
  mention: Schema.optionalKey(Mention),
}).annotate({ identifier: "SessionMessage.AgentAttachment" })

export interface SkillAttachment extends Schema.Schema.Type<typeof SkillAttachment> {}
export const SkillAttachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  text: Schema.optionalKey(Schema.String),
  mention: Schema.optionalKey(Mention),
}).annotate({ identifier: "SessionMessage.SkillAttachment" })

export const promptFields = {
  text: Schema.String,
  files: Schema.optionalKey(Schema.Array(FileAttachment)),
  agents: Schema.optionalKey(Schema.Array(AgentAttachment)),
  skills: Schema.optionalKey(Schema.Array(SkillAttachment)),
}

export interface ToolTextContent extends Schema.Schema.Type<typeof ToolTextContent> {}
export const ToolTextContent = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
}).annotate({ identifier: "SessionMessage.ToolTextContent" })

export interface ToolFileContent extends Schema.Schema.Type<typeof ToolFileContent> {}
export const ToolFileContent = Schema.Struct({
  type: Schema.Literal("file"),
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionMessage.ToolFileContent" })

export const ToolContent = Schema.Union([ToolTextContent, ToolFileContent])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionMessage.ToolContent" })
export type ToolContent = typeof ToolContent.Type

export interface ShellOutput extends Schema.Schema.Type<typeof ShellOutput> {}
export const ShellOutput = Schema.Struct({
  output: Schema.String,
  cursor: Schema.Int,
  size: Schema.Int,
  truncated: Schema.Boolean,
}).annotate({ identifier: "SessionMessage.ShellOutput" })

export const ShellStatus = Schema.Literals(["running", "exited", "timeout", "killed"])
export type ShellStatus = typeof ShellStatus.Type

const Base = {
  id: ID,
  time: Schema.Struct({ created: Time }),
}

export interface AgentSwitched extends Schema.Schema.Type<typeof AgentSwitched> {}
export const AgentSwitched = Schema.Struct({
  ...Base,
  type: Schema.tag("agent-switched"),
  agent: Schema.String,
  previous: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionMessage.AgentSwitched" })

export interface ModelSwitched extends Schema.Schema.Type<typeof ModelSwitched> {}
export const ModelSwitched = Schema.Struct({
  ...Base,
  type: Schema.tag("model-switched"),
  model: SessionModel.Ref,
  previous: Schema.optionalKey(SessionModel.Ref),
}).annotate({ identifier: "SessionMessage.ModelSwitched" })

export interface User extends Schema.Schema.Type<typeof User> {}
export const User = Schema.Struct({
  ...Base,
  ...promptFields,
  type: Schema.tag("user"),
  sender: Schema.optionalKey(Sender),
}).annotate({ identifier: "SessionMessage.User" })

export interface SyntheticMetadata extends Schema.Schema.Type<typeof SyntheticMetadata> {}
export const SyntheticMetadata = Schema.Struct({
  source: Schema.optionalKey(Schema.String),
  childID: Schema.optionalKey(Schema.String),
  shellID: Schema.optionalKey(Schema.String),
  jobID: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionMessage.SyntheticMetadata" })

export interface Synthetic extends Schema.Schema.Type<typeof Synthetic> {}
export const Synthetic = Schema.Struct({
  ...Base,
  type: Schema.tag("synthetic"),
  text: Schema.String,
  description: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(SyntheticMetadata),
}).annotate({ identifier: "SessionMessage.Synthetic" })

export interface System extends Schema.Schema.Type<typeof System> {}
export const System = Schema.Struct({
  ...Base,
  type: Schema.tag("system"),
  text: Schema.String,
  description: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionMessage.System" })

export interface Skill extends Schema.Schema.Type<typeof Skill> {}
export const Skill = Schema.Struct({
  ...Base,
  type: Schema.tag("skill"),
  skill: Schema.String,
  name: Schema.String,
  text: Schema.String,
}).annotate({ identifier: "SessionMessage.Skill" })

export interface Shell extends Schema.Schema.Type<typeof Shell> {}
export const Shell = Schema.Struct({
  ...Base,
  type: Schema.tag("shell"),
  shellID: Schema.String,
  command: Schema.String,
  status: ShellStatus,
  exit: Schema.optionalKey(Schema.Number),
  output: Schema.optionalKey(ShellOutput),
  time: Schema.Struct({ created: Time, completed: Schema.optionalKey(Time) }),
}).annotate({ identifier: "SessionMessage.Shell" })

export const Json = Schema.Record(Schema.String, Schema.Json)

export interface ToolStreaming extends Schema.Schema.Type<typeof ToolStreaming> {}
export const ToolStreaming = Schema.Struct({
  status: Schema.tag("streaming"),
  input: Schema.String,
}).annotate({ identifier: "SessionMessage.ToolStreaming" })

export interface ToolRunning extends Schema.Schema.Type<typeof ToolRunning> {}
export const ToolRunning = Schema.Struct({
  status: Schema.tag("running"),
  input: Json,
  metadata: Json,
}).annotate({ identifier: "SessionMessage.ToolRunning" })

export interface ToolCompleted extends Schema.Schema.Type<typeof ToolCompleted> {}
export const ToolCompleted = Schema.Struct({
  status: Schema.tag("completed"),
  input: Json,
  content: Schema.NonEmptyArray(ToolContent),
  metadata: Schema.optionalKey(Json),
}).annotate({ identifier: "SessionMessage.ToolCompleted" })

export interface ToolError extends Schema.Schema.Type<typeof ToolError> {}
export const ToolError = Schema.Struct({
  status: Schema.tag("error"),
  input: Json,
  error: SessionError.Info,
  content: Schema.optionalKey(Schema.NonEmptyArray(ToolContent)),
  metadata: Schema.optionalKey(Json),
}).annotate({ identifier: "SessionMessage.ToolError" })

export const ToolState = Schema.Union([ToolStreaming, ToolRunning, ToolCompleted, ToolError])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "SessionMessage.ToolState" })
export type ToolState = ToolStreaming | ToolRunning | ToolCompleted | ToolError

export interface Tool extends Schema.Schema.Type<typeof Tool> {}
export const Tool = Schema.Struct({
  type: Schema.tag("tool"),
  id: Schema.String,
  name: Schema.String,
  executed: Schema.optionalKey(Schema.Boolean),
  state: ToolState,
  time: Schema.Struct({
    created: Time,
    ran: Schema.optionalKey(Time),
    completed: Schema.optionalKey(Time),
  }),
}).annotate({ identifier: "SessionMessage.Tool" })

export interface Text extends Schema.Schema.Type<typeof Text> {}
export const Text = Schema.Struct({
  type: Schema.tag("text"),
  text: Schema.String,
}).annotate({ identifier: "SessionMessage.Text" })

export interface Reasoning extends Schema.Schema.Type<typeof Reasoning> {}
export const Reasoning = Schema.Struct({
  type: Schema.tag("reasoning"),
  text: Schema.String,
  time: Schema.optionalKey(Schema.Struct({ created: Time, completed: Schema.optionalKey(Time) })),
}).annotate({ identifier: "SessionMessage.Reasoning" })

export const Content = Schema.Union([Text, Reasoning, Tool])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionMessage.Content" })
export type Content = Text | Reasoning | Tool

export interface Retry extends Schema.Schema.Type<typeof Retry> {}
export const Retry = Schema.Struct({
  attempt: Schema.Int,
  at: Time,
  error: SessionError.Info,
}).annotate({ identifier: "SessionMessage.Retry" })

export interface Assistant extends Schema.Schema.Type<typeof Assistant> {}
export const Assistant = Schema.Struct({
  ...Base,
  type: Schema.tag("assistant"),
  agent: Schema.String,
  model: SessionModel.Ref,
  content: Schema.Array(Content),
  snapshot: Schema.optionalKey(
    Schema.Struct({
      start: Schema.optionalKey(Schema.String),
      end: Schema.optionalKey(Schema.String),
      files: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
  finish: Schema.optionalKey(FinishReason),
  cost: Schema.optionalKey(Schema.Finite),
  tokens: Schema.optionalKey(TokenUsage),
  error: Schema.optionalKey(SessionError.Info),
  retry: Schema.optionalKey(Retry),
  time: Schema.Struct({
    created: Time,
    streamed: Schema.optionalKey(Time),
    completed: Schema.optionalKey(Time),
  }),
}).annotate({ identifier: "SessionMessage.Assistant" })

export const CompactionReason = Schema.Literals(["auto", "manual"])
export type CompactionReason = typeof CompactionReason.Type

export interface CompactionRunning extends Schema.Schema.Type<typeof CompactionRunning> {}
export const CompactionRunning = Schema.Struct({
  ...Base,
  type: Schema.tag("compaction"),
  status: Schema.tag("running"),
  reason: CompactionReason,
  summary: Schema.String,
  recent: Schema.String,
}).annotate({ identifier: "SessionMessage.CompactionRunning" })

export interface CompactionCompleted extends Schema.Schema.Type<typeof CompactionCompleted> {}
export const CompactionCompleted = Schema.Struct({
  ...Base,
  type: Schema.tag("compaction"),
  status: Schema.tag("completed"),
  reason: CompactionReason,
  model: Schema.optionalKey(SessionModel.Ref),
  summary: Schema.String,
  recent: Schema.String,
  cost: Schema.optionalKey(Schema.Finite),
  tokens: Schema.optionalKey(TokenUsage),
}).annotate({ identifier: "SessionMessage.CompactionCompleted" })

export interface CompactionFailed extends Schema.Schema.Type<typeof CompactionFailed> {}
export const CompactionFailed = Schema.Struct({
  ...Base,
  type: Schema.tag("compaction"),
  status: Schema.tag("failed"),
  reason: CompactionReason,
  error: SessionError.Info,
  cost: Schema.optionalKey(Schema.Finite),
  tokens: Schema.optionalKey(TokenUsage),
}).annotate({ identifier: "SessionMessage.CompactionFailed" })

export const Compaction = Schema.Union([CompactionRunning, CompactionCompleted, CompactionFailed])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "SessionMessage.Compaction" })
export type Compaction = CompactionRunning | CompactionCompleted | CompactionFailed

export const Outcome = Schema.Literals(["succeeded", "failed", "interrupted"])
export type Outcome = typeof Outcome.Type

export interface Idle extends Schema.Schema.Type<typeof Idle> {}
export const Idle = Schema.Struct({
  ...Base,
  type: Schema.tag("idle"),
  outcome: Outcome,
  error: Schema.optionalKey(SessionError.Info),
}).annotate({ identifier: "SessionMessage.Idle" })

export const Info = Schema.Union([
  AgentSwitched,
  ModelSwitched,
  User,
  Synthetic,
  System,
  Skill,
  Shell,
  Assistant,
  Compaction,
  Idle,
]).annotate({ identifier: "SessionMessage.Info" })
export type Info =
  AgentSwitched | ModelSwitched | User | Synthetic | System | Skill | Shell | Assistant | Compaction | Idle
export type Type = Info["type"]

export interface Page extends Schema.Schema.Type<typeof Page> {}
export const Page = Schema.Struct({
  items: Schema.Array(Info),
  cursor: Schema.Struct({
    previous: Schema.optionalKey(Schema.String),
    next: Schema.optionalKey(Schema.String),
  }),
}).annotate({ identifier: "SessionMessage.Page" })
