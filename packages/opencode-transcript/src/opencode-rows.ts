export * as OpenCodeRows from "./opencode-rows.js"

import { fromRow } from "@opencode/core/session/info"
import { Agent } from "@opencode/schema/agent"
import { ProjectID } from "@opencode/schema/project-id"
import { SessionID } from "@opencode/schema/session-id"
import { SessionLegacy } from "@opencode/schema/session-legacy"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { WorkspaceID } from "@opencode/schema/workspace-id"
import type { Session } from "@ren/schema/session"
import { Sync } from "@ren/schema/sync"
import { DateTime, Effect, Exit, Option, Schema, Struct } from "effect"

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

export class Unreadable extends Schema.TaggedError<Unreadable>()("OpenCodeRows.Unreadable", {
  message: Schema.String,
}) {}

const encodeMessage = Schema.encodeSync(SessionMessage.Info)

// oxlint-disable-next-line ren/no-comments -- An OpenCode export as rows, as OpenCode's own import writes them (`SessionTransfer.import`): each message encoded, in order from seq 1. The laptop's agent, model, permissions, metadata and workspace mean nothing to a brain, which sets its own at start.
export const fromExport = Effect.fnUntraced(function* (id: Session.ID, transcript: unknown) {
  const data = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(SessionTransfer.Data))(transcript).pipe(
    Effect.mapError(
      (error) =>
        new Unreadable({ message: `The transcript is not an OpenCode export this Ren reads: ${error.message}` }),
    ),
  )
  const info = data.info
  if (String(info.id) !== id)
    return yield* new Unreadable({ message: `The transcript is of session ${info.id}, not ${id}.` })
  if (info.parentID) return yield* new Unreadable({ message: "A subagent session cannot be moved on its own." })
  if (new Set(data.messages.map((message) => message.id)).size !== data.messages.length)
    return yield* new Unreadable({ message: "The transcript has two messages with one ID." })
  const millis = (time: DateTime.Utc | undefined) => (time ? DateTime.toEpochMillis(time) : null)
  const session: Sync.OpenCodeSessionRow = {
    id,
    parent_id: null,
    project_id: info.projectID,
    workspace_id: null,
    slug: id,
    directory: info.location.directory,
    path: info.subpath ?? null,
    title: info.title ?? null,
    version: "",
    summary_additions: null,
    summary_deletions: null,
    summary_files: null,
    metadata: null,
    cost: info.cost,
    tokens_input: info.tokens.input,
    tokens_output: info.tokens.output,
    tokens_reasoning: info.tokens.reasoning,
    tokens_cache_read: info.tokens.cache.read,
    tokens_cache_write: info.tokens.cache.write,
    permission: null,
    agent: null,
    model: null,
    time_created: DateTime.toEpochMillis(info.time.created),
    time_updated: DateTime.toEpochMillis(info.time.updated),
    time_idle: millis(info.time.idle),
    time_viewed: millis(info.time.viewed),
    idle_outcome: info.outcome ?? null,
    time_archived: null,
    time_suspended: null,
  }
  return {
    session,
    messages: data.messages.map((message, index): Sync.OpenCodeMessageRow => {
      const encoded = encodeMessage(message)
      return {
        id: message.id,
        session_id: id,
        type: message.type,
        seq: index + 1,
        data: JSON.stringify(Struct.omit(encoded, ["id", "type"])),
      }
    }),
  }
})

export const tooLarge = "Output too large, not saved."

const Created = Schema.fromJsonString(Schema.Struct({ time: Schema.Struct({ created: Schema.Number }) }))

// oxlint-disable-next-line ren/no-comments -- A message larger than the sync limit syncs as a short synthetic message with its id and time, so the rest of its chat syncs and a restore still has the message's place.
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
