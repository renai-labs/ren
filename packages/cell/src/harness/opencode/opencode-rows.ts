export * as OpenCodeRows from "./opencode-rows.js"

import { fromRow } from "@opencode/core/session/info"
import { ProjectID } from "@opencode/schema/project-id"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { WorkspaceID } from "@opencode/schema/workspace-id"
import { Sync } from "@ren/schema/sync"
import { Exit, Schema } from "effect"

const JsonColumn = <S extends Schema.Top>(schema: S) => Schema.NullOr(Schema.fromJsonString(schema))

const SessionRow = Schema.Struct({
  ...Sync.OpenCodeSessionRow.fields,
  id: SessionID,
  parent_id: Schema.NullOr(SessionID),
  project_id: ProjectID,
  workspace_id: Schema.NullOr(WorkspaceID),
  metadata: JsonColumn(Schema.Record(Schema.String, Schema.Json)),
  permission: JsonColumn(
    Schema.Array(
      Schema.Struct({
        action: Schema.String,
        resource: Schema.String,
        effect: Schema.Literals(["allow", "deny", "ask"]),
      }),
    ),
  ),
  model: JsonColumn(
    Schema.Struct({ id: Schema.String, providerID: Schema.String, variant: Schema.optionalKey(Schema.String) }),
  ),
  idle_outcome: Schema.NullOr(Schema.Literals(["succeeded", "failed", "interrupted"])),
})

const MessageData = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))

export const session = (row: unknown) =>
  fromRow({
    ...Schema.decodeUnknownSync(SessionRow)(row),
    fork_session_id: null,
    fork_boundary: null,
    share_url: null,
    summary_diffs: null,
    revert: null,
    time_compacting: null,
    resume_attempts: 0,
  })

export const message = (row: typeof Sync.OpenCodeMessageRow.Type) =>
  Exit.match(Schema.decodeUnknownExit(MessageData)(row.data), {
    onFailure: Exit.failCause,
    onSuccess: (data) => Schema.decodeUnknownExit(SessionMessage.Info)({ ...data, id: row.id, type: row.type }),
  })
