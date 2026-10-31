export * as OpenCodeStore from "./opencode-store.js"

import type { Sync } from "@ren/schema/sync"
import { Database } from "@ren/db/database"
import type { Session } from "@ren/schema/session"
import { and, asc, desc, eq, getColumns, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { Effect, Option, Record, Struct } from "effect"

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

export const search = (text: string | undefined) => {
  if (!text) return
  const pattern = `%${text.replaceAll(/[\\%_]/gu, "\\$&")}%`
  return or(
    ilike(Database.Schema.opencode_session.title, pattern),
    sql`exists (
      select 1 from ${Database.Schema.opencode_message}
      where ${Database.Schema.opencode_message.session_id} = ${Database.Schema.agent_session.id}
        and ${Database.Schema.opencode_message.removed_at} is null
        and (case ${Database.Schema.opencode_message.type}
          when 'user' then ${Database.Schema.opencode_message.data}::jsonb ->> 'text'
          when 'assistant' then jsonb_path_query_array(
            ${Database.Schema.opencode_message.data}::jsonb, '$.content[*] ? (@.type == "text").text'
          )::text
        end) ilike ${pattern}
    )`,
  )
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

// oxlint-disable-next-line ren/no-comments -- The brain notes a chat whose workspace files were lost with a synthetic message (E105); Ren keeps its time for the app's notice (E117).
export const filesResetAt = Effect.fnUntraced(function* (transaction: Database.Transaction, sessionId: Session.ID) {
  const delivered = yield* transaction
    .select({
      at: sql<string | null>`max((${Database.Schema.opencode_message.data}::jsonb -> 'time' ->> 'created')::bigint)`,
    })
    .from(Database.Schema.opencode_message)
    .where(
      and(
        eq(Database.Schema.opencode_message.session_id, sessionId),
        eq(Database.Schema.opencode_message.type, "synthetic"),
        isNull(Database.Schema.opencode_message.removed_at),
        sql`${Database.Schema.opencode_message.data}::jsonb -> 'metadata' ->> 'source' = 'ren.files-reset'`,
      ),
    )
  const waiting = yield* transaction
    .select({ at: sql<string | null>`max(${Database.Schema.opencode_inbox.time_created})` })
    .from(Database.Schema.opencode_inbox)
    .where(
      and(
        eq(Database.Schema.opencode_inbox.session_id, sessionId),
        eq(Database.Schema.opencode_inbox.type, "synthetic"),
        sql`${Database.Schema.opencode_inbox.payload}::jsonb -> 'metadata' ->> 'source' = 'ren.files-reset'`,
      ),
    )
  const times = [delivered.at(0)?.at, waiting.at(0)?.at].flatMap((at) => (at ? [Number(at)] : []))
  return times.length === 0 ? Option.none<Date>() : Option.some(new Date(Math.max(...times)))
})

export const keepInbox = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  sessionId: Session.ID,
  rows: ReadonlyArray<Sync.OpenCodeInboxRow>,
) {
  yield* transaction
    .delete(Database.Schema.opencode_inbox)
    .where(eq(Database.Schema.opencode_inbox.session_id, sessionId))
  if (rows.length > 0) yield* transaction.insert(Database.Schema.opencode_inbox).values([...rows])
})

export const inbox = (transaction: Database.Transaction, ids: ReadonlyArray<Session.ID>) =>
  transaction
    .select()
    .from(Database.Schema.opencode_inbox)
    .where(inArray(Database.Schema.opencode_inbox.session_id, [...ids]))
    .orderBy(asc(Database.Schema.opencode_inbox.enqueued_seq))

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

const before = (cursor: Cursor) =>
  sql`(${Database.Schema.opencode_message.seq}, ${Database.Schema.opencode_message.id}) < (${cursor.seq}, ${cursor.id})`

export const history = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  sessionId: Session.ID,
  input: { readonly before?: Cursor | undefined; readonly revertMessageId: string | null; readonly limit: number },
) {
  const revert = input.revertMessageId
    ? (yield* transaction
        .select({ seq: Database.Schema.opencode_message.seq, id: Database.Schema.opencode_message.id })
        .from(Database.Schema.opencode_message)
        .where(
          and(
            eq(Database.Schema.opencode_message.session_id, sessionId),
            eq(Database.Schema.opencode_message.id, input.revertMessageId),
          ),
        )).at(0)
    : undefined
  return yield* transaction
    .select({
      seq: Database.Schema.opencode_message.seq,
      id: Database.Schema.opencode_message.id,
      bytes: sql<number>`octet_length(${Database.Schema.opencode_message.data})::int`,
    })
    .from(Database.Schema.opencode_message)
    .where(
      and(
        eq(Database.Schema.opencode_message.session_id, sessionId),
        isNull(Database.Schema.opencode_message.removed_at),
        input.before && before(input.before),
        revert && before(revert),
      ),
    )
    .orderBy(desc(Database.Schema.opencode_message.seq), desc(Database.Schema.opencode_message.id))
    .limit(input.limit)
})

export const messagesOf = (transaction: Database.Transaction, sessionId: Session.ID, ids: ReadonlyArray<string>) =>
  transaction
    .select(Struct.omit(getColumns(Database.Schema.opencode_message), ["removed_at"]))
    .from(Database.Schema.opencode_message)
    .where(
      and(
        eq(Database.Schema.opencode_message.session_id, sessionId),
        inArray(Database.Schema.opencode_message.id, [...ids]),
      ),
    )
    .orderBy(desc(Database.Schema.opencode_message.seq), desc(Database.Schema.opencode_message.id))

// oxlint-disable-next-line ren/no-comments -- A restore page stops at limit rows or at maxBytes of row data, whichever comes first, and always has at least one row (INV-53).
export const messages = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  sessionId: Session.ID,
  input: { readonly after: Cursor | undefined; readonly limit: number; readonly maxBytes: number },
) {
  const table = Database.Schema.opencode_message
  const order = sql`order by ${table.seq}, ${table.id}`
  const ranked = transaction
    .select({
      id: table.id,
      session_id: table.session_id,
      type: table.type,
      seq: table.seq,
      data: table.data,
      running: sql<string>`sum(octet_length(${table.data})) over (${order})`.as("running"),
      position: sql<number>`row_number() over (${order})`.as("position"),
      remaining: sql<number>`(count(*) over ())::int`.as("remaining"),
    })
    .from(table)
    .where(
      and(
        eq(table.session_id, sessionId),
        isNull(table.removed_at),
        input.after && sql`(${table.seq}, ${table.id}) > (${input.after.seq}, ${input.after.id})`,
      ),
    )
    .as("ranked")
  const rows = yield* transaction
    .select({
      id: ranked.id,
      session_id: ranked.session_id,
      type: ranked.type,
      seq: ranked.seq,
      data: ranked.data,
      remaining: ranked.remaining,
    })
    .from(ranked)
    .where(or(eq(ranked.position, 1), sql`${ranked.running} <= ${input.maxBytes}`))
    .orderBy(asc(ranked.position))
    .limit(input.limit)
  return {
    rows: rows.map((row) => Struct.omit(row, ["remaining"])),
    hasMore: (rows.at(0)?.remaining ?? 0) > rows.length,
  }
})
