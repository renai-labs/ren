export * as SyncFixture from "./sync-fixture.js"

import type { CurrentHost } from "@ren/host-api/ren-host-api"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import type { Sync } from "@ren/schema/sync"
import type { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { SessionSync } from "../../src/session-sync.js"

export const now = 1_760_000_000_000

export const host = (organizationId: Auth.OrganizationID, rootId: Session.ID): CurrentHost["Service"] => ({
  brainId: Brain.ofSession(rootId),
  organizationId,
  generation: 1,
})

export const session = (id: Session.ID, fields: Partial<Sync.OpenCodeSessionRow> = {}): Sync.OpenCodeSessionRow => ({
  id,
  project_id: "prj_1",
  workspace_id: null,
  parent_id: null,
  slug: "calm-river",
  directory: "/workspace",
  path: null,
  title: null,
  version: "2.0.27",
  summary_additions: null,
  summary_deletions: null,
  summary_files: null,
  metadata: null,
  cost: 0.25,
  tokens_input: 3_000_000_000,
  tokens_output: 20,
  tokens_reasoning: 0,
  tokens_cache_read: 0,
  tokens_cache_write: 0,
  permission: JSON.stringify([{ permission: "bash", pattern: "*", action: "allow" }]),
  agent: "build",
  model: JSON.stringify({ providerID: "stub", modelID: "stub" }),
  time_created: now,
  time_updated: now,
  time_idle: null,
  time_viewed: null,
  idle_outcome: null,
  time_archived: null,
  time_suspended: null,
  ...fields,
})

export const message = (
  sessionId: Session.ID,
  id: string,
  seq: number,
  fields: Partial<Sync.OpenCodeMessageRow> = {},
): Sync.OpenCodeMessageRow => ({
  id,
  session_id: sessionId,
  type: "user",
  seq,
  data: JSON.stringify({ text: id }),
  ...fields,
})

export const pass = Effect.fnUntraced(function* (
  host: CurrentHost["Service"],
  row: Sync.OpenCodeSessionRow,
  seq: number,
  messages: ReadonlyArray<Sync.OpenCodeMessageRow>,
) {
  const sync = yield* SessionSync.Service
  const upload = yield* sync.startUpload(host, row.id, { harness: "opencode", parentId: row.parent_id })
  yield* sync.uploadMessages(host, row.id, upload, messages)
  yield* sync.commit(host, row.id, upload, { session: row, seq, ids: messages.map((message) => message.id) })
})
