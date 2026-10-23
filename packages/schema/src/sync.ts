export * as Sync from "./sync.js"

import { Schema } from "effect"
import { Session } from "./session.js"

const Json = Schema.String.annotate({ description: "The exact JSON text of the OpenCode column." })

const EpochMillis = Schema.Int.annotate({ description: "Epoch milliseconds." })

export const OpenCodeSessionRow = Schema.Struct({
  id: Session.ID.annotate({ description: "The session ID. OpenCode and Ren use the same ID for a session." }),
  parent_id: Schema.NullOr(Session.ID).annotate({
    description:
      "The parent session that the host reports. Ren keeps its own parent from the upload that adopts the session, and ignores this value on commit.",
  }),
  project_id: Schema.String,
  workspace_id: Schema.NullOr(Schema.String),
  slug: Schema.String,
  directory: Schema.String,
  path: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  version: Schema.String,
  summary_additions: Schema.NullOr(Schema.Int),
  summary_deletions: Schema.NullOr(Schema.Int),
  summary_files: Schema.NullOr(Schema.Int),
  metadata: Schema.NullOr(Json),
  cost: Schema.Finite,
  tokens_input: Schema.Int,
  tokens_output: Schema.Int,
  tokens_reasoning: Schema.Int,
  tokens_cache_read: Schema.Int,
  tokens_cache_write: Schema.Int,
  permission: Schema.NullOr(Json),
  agent: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Json),
  time_created: EpochMillis,
  time_updated: EpochMillis,
  time_idle: Schema.NullOr(EpochMillis),
  time_viewed: Schema.NullOr(EpochMillis),
  idle_outcome: Schema.NullOr(Schema.String),
  time_archived: Schema.NullOr(EpochMillis),
  time_suspended: Schema.NullOr(EpochMillis).annotate({
    description: "Set while the session runs. Ren shows the session as busy when it is set.",
  }),
}).annotate({
  identifier: "Sync.OpenCodeSessionRow",
  description:
    "The columns of an OpenCode `session_v2` row that restore and the display of a session need. Ren does not keep `fork_session_id`, `fork_boundary` and `revert`, because OpenCode import drops them; `summary_diffs`, because it holds whole patches; or `share_url`, `time_compacting` and `resume_attempts`, because they are internal to OpenCode.",
})
export interface OpenCodeSessionRow extends Schema.Schema.Type<typeof OpenCodeSessionRow> {}

export const RestoredChat = Schema.Struct({
  id: Session.ID,
  harness: Session.Harness,
  harnessVersion: Schema.NullOr(Schema.String).annotate({ description: "The harness version of the last upload." }),
  parentId: Schema.NullOr(Session.ID),
  revertMessageId: Schema.NullOr(Schema.String).annotate({
    description: "The first message that a staged revert hides, or null.",
  }),
  session: Schema.NullOr(OpenCodeSessionRow).annotate({ description: "Null when the chat has no transcript in Ren." }),
  start: Schema.optionalKey(Session.StartInput).annotate({
    description: "Present when the chat has no transcript: the start input, with the first message.",
  }),
  directory: Schema.optionalKey(Schema.String).annotate({
    description: "With `start`: the folder on the chat’s hand, as a start from Ren would give it.",
  }),
}).annotate({
  identifier: "Sync.RestoredChat",
  description: "One chat of a restored group. Its messages are read page by page with `sync.messages`.",
})
export interface RestoredChat extends Schema.Schema.Type<typeof RestoredChat> {}

export const OpenCodeMessageRow = Schema.Struct({
  id: Schema.String,
  session_id: Session.ID,
  type: Schema.String,
  seq: Schema.Int.annotate({
    description: "The OpenCode event that made the row. Restore reads messages in `(seq, id)` order.",
  }),
  data: Json,
}).annotate({
  identifier: "Sync.OpenCodeMessageRow",
  description:
    "The columns of an OpenCode `session_message` row that restore needs. OpenCode decodes a message from `id`, `type` and `data`, and `data` holds the message times, so Ren does not keep `time_created` and `time_updated`.",
})
export interface OpenCodeMessageRow extends Schema.Schema.Type<typeof OpenCodeMessageRow> {}

export const maxBodyBytes = 8 * 1024 * 1024

export interface Cursor extends Schema.Schema.Type<typeof Cursor> {}
export const Cursor = Schema.Struct({ seq: Schema.Int, id: Schema.String }).annotate({
  identifier: "Sync.Cursor",
  description: "The last message of a page. The next page starts after it in `(seq, id)` order.",
})

export interface Checkpoint extends Schema.Schema.Type<typeof Checkpoint> {}
export const Checkpoint = Schema.Struct({
  id: Session.ID,
  syncSeq: Schema.NullOr(Schema.Int).annotate({
    description: "The OpenCode checkpoint of the last committed pass. Null forces the next pass.",
  }),
  timeSuspended: Schema.NullOr(EpochMillis).annotate({ description: "The `time_suspended` of the Ren copy." }),
}).annotate({ identifier: "Sync.Checkpoint" })
