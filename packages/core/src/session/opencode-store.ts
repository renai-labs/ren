export * as OpenCodeStore from "./opencode-store.js"

import type { Sync } from "@ren/schema/sync"
import { Database } from "@ren/db/database"
import type { Session } from "@ren/schema/session"
import { and, asc, eq, getColumns, inArray, isNull, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { Effect, Record, Struct } from "effect"

export interface Cursor {
  readonly seq: number
  readonly id: string
}

const excluded = <T extends PgTable>(table: T) =>
  Record.map(getColumns(table), (column) => sql`excluded.${sql.identifier(column.name)}`)

export const join = eq(Database.Schema.opencode_session.session_id, Database.Schema.agent_session.id)

export const summary = {
  title: Database.Schema.opencode_session.title,
  timeSuspended: Database.Schema.opencode_session.time_suspended,
  outcome: Database.Schema.opencode_session.idle_outcome,
  updatedAt: Database.Schema.opencode_session.time_updated,
}

export const writeMessages = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  rows: ReadonlyArray<Sync.OpenCodeMessageRow>,
) {
  if (rows.length === 0) return
  yield* transaction
    .insert(Database.Schema.opencode_message)
    .values([...rows])
    .onConflictDoUpdate({
      target: [Database.Schema.opencode_message.session_id, Database.Schema.opencode_message.id],
      set: excluded(Database.Schema.opencode_message),
    })
})

export const writeSession = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  row: Sync.OpenCodeSessionRow,
) {
  yield* transaction
    .insert(Database.Schema.opencode_session)
    .values({ ...Struct.omit(row, ["id", "parent_id"]), session_id: row.id })
    .onConflictDoUpdate({
      target: Database.Schema.opencode_session.session_id,
      set: excluded(Database.Schema.opencode_session),
    })
})

export const keepMessages = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  sessionId: Session.ID,
  ids: ReadonlyArray<string>,
) {
  yield* transaction
    .update(Database.Schema.opencode_message)
    .set({ removed_at: sql`now()` })
    .where(
      and(
        eq(Database.Schema.opencode_message.session_id, sessionId),
        isNull(Database.Schema.opencode_message.removed_at),
        ids.length > 0 ? sql`${Database.Schema.opencode_message.id} <> all(${sql.param(ids)}::text[])` : undefined,
      ),
    )
})

export const sessions = (transaction: Database.Transaction, ids: ReadonlyArray<Session.ID>) =>
  transaction
    .select({ opencode: Database.Schema.opencode_session, parentId: Database.Schema.agent_session.parent_id })
    .from(Database.Schema.opencode_session)
    .innerJoin(Database.Schema.agent_session, join)
    .where(inArray(Database.Schema.opencode_session.session_id, [...ids]))
    .orderBy(asc(Database.Schema.agent_session.created_at), asc(Database.Schema.agent_session.id))
    .pipe(
      Effect.map((rows) =>
        rows.map((row): Sync.OpenCodeSessionRow => ({
          ...Struct.omit(row.opencode, ["session_id"]),
          id: row.opencode.session_id,
          parent_id: row.parentId,
        })),
      ),
    )

export const messages = (
  transaction: Database.Transaction,
  sessionId: Session.ID,
  after: Cursor | undefined,
  limit: number,
) =>
  transaction
    .select(Struct.omit(getColumns(Database.Schema.opencode_message), ["removed_at"]))
    .from(Database.Schema.opencode_message)
    .where(
      and(
        eq(Database.Schema.opencode_message.session_id, sessionId),
        isNull(Database.Schema.opencode_message.removed_at),
        after &&
          sql`(${Database.Schema.opencode_message.seq}, ${Database.Schema.opencode_message.id}) > (${after.seq}, ${after.id})`,
      ),
    )
    .orderBy(asc(Database.Schema.opencode_message.seq), asc(Database.Schema.opencode_message.id))
    .limit(limit)
