import { Session } from "@ren/schema/session"
import { Schema } from "effect"

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
