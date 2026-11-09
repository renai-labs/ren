export * as OpenCodeRows from "./opencode-rows.js"

import { fromRow } from "@opencode/core/session/info"
import { Agent } from "@opencode/schema/agent"
import { ProjectID } from "@opencode/schema/project-id"
import { SessionID } from "@opencode/schema/session-id"
import { SessionLegacy } from "@opencode/schema/session-legacy"
import { SessionMessage } from "@opencode/schema/session-message"
import { WorkspaceID } from "@opencode/schema/workspace-id"
import { Sync } from "@ren/schema/sync"
import { Exit, Option, Schema } from "effect"

const JsonColumn = <S extends Schema.Top>(schema: S) => Schema.NullOr(Schema.fromJsonString(schema))

const SessionRow = Schema.Struct({
  ...Sync.OpenCodeSessionRow.fields,
  id: SessionID,
  parent_id: Schema.NullOr(SessionID),
  project_id: ProjectID,
  workspace_id: Schema.NullOr(WorkspaceID),
  agent: Schema.NullOr(Agent.ID),
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
    time_busy: null,
    resume_attempts: 0,
  })

const input = (row: typeof Sync.OpenCodeMessageRow.Type, data: typeof MessageData.Type) => ({
  ...SessionLegacy.message(row.type, data),
  id: row.id,
  type: row.type,
})

export const stored = (row: typeof Sync.OpenCodeMessageRow.Type) =>
  input(row, Schema.decodeUnknownSync(MessageData)(row.data))

export const message = (row: typeof Sync.OpenCodeMessageRow.Type) =>
  Exit.match(Schema.decodeUnknownExit(MessageData)(row.data), {
    onFailure: Exit.failCause,
    onSuccess: (data) => Schema.decodeUnknownExit(SessionMessage.Info)(input(row, data)),
  })

export const tooLarge = "Output too large, not saved."

const Created = Schema.fromJsonString(Schema.Struct({ time: Schema.Struct({ created: Schema.Number }) }))

// oxlint-disable-next-line ren/no-comments -- EN37: a message larger than the sync limit syncs as a short synthetic message with its id and time, so the rest of its chat syncs and a restore still has the message's place.
export const standIn = (row: Sync.OpenCodeMessageRow): Sync.OpenCodeMessageRow => ({
  id: row.id,
  session_id: row.session_id,
  seq: row.seq,
  type: "synthetic",
  data: JSON.stringify({
    time: {
      created: Option.match(Schema.decodeUnknownOption(Created)(row.data), {
        onNone: () => 0,
        onSome: (found) => found.time.created,
      }),
    },
    text: tooLarge,
  }),
})
