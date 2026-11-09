export * as OpenCodeImport from "./opencode-import.js"

import { Database } from "bun:sqlite"
import type { OpenCodeClient } from "@opencode/client/effect"
import { SessionID } from "@opencode/schema/session-id"
import { OpenCodeRows } from "@ren/opencode-transcript/opencode-rows"
import type { Session } from "@ren/schema/session"
import { Sync } from "@ren/schema/sync"
import { Effect, Schema } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrainTest } from "./brain.js"

export const all = (database: string, sql: string, ...params: ReadonlyArray<string>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => new Database(database, { readonly: true })),
    (db) => Effect.sync(() => db.query(sql).all(...params)),
    (db) => Effect.sync(() => db.close()),
  )

export const exported = Effect.fnUntraced(function* (database: string, sessionID: string) {
  const row = (yield* all(database, "select * from session_v2 where id = ?", sessionID)).at(0)
  const rows = yield* Schema.decodeUnknownEffect(Schema.Array(Sync.OpenCodeMessageRow))(
    yield* all(
      database,
      "select id, session_id, type, seq, data from session_message where session_id = ? order by seq, id",
      sessionID,
    ),
  )
  return {
    info: OpenCodeRows.session(row),
    messages: yield* Effect.forEach(rows, OpenCodeRows.message),
  }
})

export const folder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "ren-import-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
)

export const open = Effect.fnUntraced(function* (id?: Session.ID) {
  const database = join(yield* folder, "opencode.db")
  return { ...(yield* BrainTest.make({ database, ...(id && { id }) })), database }
})

export const turn = Effect.fnUntraced(function* (brain: Effect.Success<ReturnType<typeof open>>, text: string) {
  yield* brain.send(text)
  yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
})

export const importOf = (client: OpenCodeClient, data: Effect.Success<ReturnType<typeof exported>>) =>
  client.session.import({ info: data.info, messages: data.messages, location: data.info.location })
