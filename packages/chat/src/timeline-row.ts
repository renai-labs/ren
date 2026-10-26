export * as TimelineRow from "./timeline-row.js"

import { Data, Equal, Match } from "effect"

export interface PartRef {
  readonly messageID: string
  readonly partID: string
}

export type PartGroup =
  | { readonly key: string; readonly type: "part"; readonly ref: PartRef }
  | { readonly key: string; readonly type: "context" | "file" | "read"; readonly refs: ReadonlyArray<PartRef> }

export class TurnGap extends Data.TaggedClass("TurnGap")<{ readonly userMessageID: string }> {}

export class UserMessage extends Data.TaggedClass("UserMessage")<{ readonly userMessageID: string }> {}

export class Shell extends Data.TaggedClass("Shell")<{ readonly userMessageID: string; readonly messageID: string }> {}

export class Notice extends Data.TaggedClass("Notice")<{
  readonly userMessageID: string
  readonly messageID: string
}> {}

export class TurnDivider extends Data.TaggedClass("TurnDivider")<{ readonly userMessageID: string }> {}

export class AssistantPart extends Data.TaggedClass("AssistantPart")<{
  readonly userMessageID: string
  readonly group: PartGroup
  readonly previousAssistantPart: boolean
  readonly spacing?: "tool" | "content"
}> {}

export class Thinking extends Data.TaggedClass("Thinking")<{ readonly userMessageID: string; readonly ref: PartRef }> {}

export class Error extends Data.TaggedClass("Error")<{
  readonly userMessageID: string
  readonly kind: string
  readonly text: string
}> {}

export class Retry extends Data.TaggedClass("Retry")<{ readonly userMessageID: string }> {}

export class CompactionQueued extends Data.TaggedClass("CompactionQueued")<{
  readonly userMessageID: string
  readonly inboxID: string
}> {}

export type Row =
  TurnGap | UserMessage | Shell | Notice | TurnDivider | AssistantPart | Thinking | Error | Retry | CompactionQueued

export const key: (row: Row) => string = Match.typeTags<Row>()({
  TurnGap: (row) => `turn-gap:${row.userMessageID}`,
  UserMessage: (row) => `user-message:${row.userMessageID}`,
  Shell: (row) => `shell:${row.messageID}`,
  Notice: (row) => `notice:${row.messageID}`,
  TurnDivider: (row) => `turn-divider:${row.userMessageID}`,
  AssistantPart: (row) => `assistant-part:${row.group.type}:${row.group.key}`,
  Thinking: (row) => `thinking:${row.userMessageID}`,
  Error: (row) => `error:${row.userMessageID}`,
  Retry: (row) => `retry:${row.userMessageID}`,
  CompactionQueued: (row) => `compaction-queued:${row.inboxID}`,
})

export const equals = (a: Row, b: Row) => Equal.equals(a, b)
