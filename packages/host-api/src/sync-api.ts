import { Session } from "@ren/schema/session"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { StaleUploadError } from "./errors.js"
import { HostAuthentication } from "./host-api.js"

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

export const maxBodyBytes = 8 * 1024 * 1024

const Cursor = Schema.Struct({ seq: Schema.Int, id: Schema.String }).annotate({
  identifier: "Sync.Cursor",
  description: "The last message of a page. The next page starts after it in `(seq, id)` order.",
})

const Checkpoint = Schema.Struct({
  id: Session.ID,
  syncSeq: Schema.NullOr(Schema.Int).annotate({
    description: "The OpenCode checkpoint of the last committed pass. Null forces the next pass.",
  }),
  timeSuspended: Schema.NullOr(EpochMillis).annotate({ description: "The `time_suspended` of the Ren copy." }),
}).annotate({ identifier: "Sync.Checkpoint" })

const SessionParams = { id: Session.ID }

const UploadParams = { id: Session.ID, upload: Schema.Int }

const MessagesQuery = Schema.Struct({
  afterSeq: Schema.optionalKey(Schema.Int),
  afterId: Schema.optionalKey(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
}).check(
  Schema.makeFilter((query) => "afterSeq" in query === "afterId" in query || "Send afterSeq and afterId together"),
)

const SyncGroup = HttpApiGroup.make("sync")
  .add(
    HttpApiEndpoint.post("sync.checkpoints", "/brain/sync/checkpoints", {
      success: Schema.Struct({ sessions: Schema.Array(Checkpoint) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.checkpoints",
        summary: "Read the checkpoints",
        description: "Read the Ren copy of each session in the scope of the host token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.startUpload", "/brain/sync/sessions/:id/uploads", {
      params: SessionParams,
      payload: Schema.Struct({
        harness: Session.Harness,
        parentId: Schema.NullOr(Session.ID).annotate({
          description:
            "The parent that the host reports. Ren adopts an unknown session when its parent is in the scope.",
        }),
      }),
      success: Schema.Struct({ upload: Schema.Int }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.startUpload",
        summary: "Start an upload",
        description: "Open a new upload of a session. Writes of an older upload of the session fail from now on.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.uploadMessages", "/brain/sync/sessions/:id/uploads/:upload/messages", {
      params: UploadParams,
      payload: Schema.Struct({ messages: Schema.Array(OpenCodeMessageRow) }),
      error: StaleUploadError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.uploadMessages",
        summary: "Upload messages",
        description: "Write a batch of message rows to the open upload.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.commit", "/brain/sync/sessions/:id/uploads/:upload/commit", {
      params: UploadParams,
      payload: Schema.Struct({
        session: OpenCodeSessionRow,
        seq: Schema.Int.annotate({ description: "The OpenCode checkpoint that the host read before the messages." }),
        ids: Schema.Array(Schema.String).annotate({
          description: "The IDs of all messages that the upload sent. Ren deletes the other messages of the session.",
        }),
      }),
      error: StaleUploadError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.commit",
        summary: "Commit an upload",
        description: "Write the session row, delete the messages that the upload did not send, and close the upload.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.restore", "/brain/sync/restore", {
      payload: Schema.Struct({ sessionId: Session.ID }),
      success: Schema.Struct({ sessions: Schema.Array(OpenCodeSessionRow) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.restore",
        summary: "Restore a session tree",
        description:
          "Close the open uploads of the tree and clear its checkpoints. Return the session rows of the tree, each parent before its children.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("sync.messages", "/brain/sync/sessions/:id/messages", {
      params: SessionParams,
      query: MessagesQuery,
      success: Schema.Struct({ messages: Schema.Array(OpenCodeMessageRow), next: Schema.NullOr(Cursor) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.messages",
        summary: "Read messages",
        description: "Read one page of the message rows of a session in `(seq, id)` order.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "sync" }))

export const SyncApi = HttpApi.make("sync")
  .add(SyncGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Sync API",
      version: "0.0.0",
      description: `Internal API a session host calls to upload and restore its sessions. Ren refuses a body larger than ${maxBodyBytes} bytes.`,
    }),
  )
