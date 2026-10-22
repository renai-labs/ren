import { Sync } from "@ren/schema/sync"
import { Effect, Exit, Result, Schema } from "effect"
import { Harness } from "../../src/harness/harness.js"
import { SessionCell } from "../../src/session-cell.js"
import worker from "../../src/worker.js"
import { OpenCodeRows } from "../../src/harness/opencode/opencode-rows.js"

const tables = ["event_sequence", "session_message", "session_v2"]

const Names = Schema.Array(Schema.Struct({ name: Schema.String }))

const Seqs = Schema.Array(Schema.Struct({ seq: Schema.Int }))

const Ids = Schema.Array(Schema.Struct({ id: Schema.String }))

const Size = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  seq: Schema.Int,
  bytes: Schema.Int,
})

const SessionState = Schema.Struct({
  time_suspended: Schema.NullOr(Schema.Int),
  idle_outcome: Schema.NullOr(Schema.String),
})

const step = <A>(evaluate: () => A) =>
  Result.match(Result.try({ try: evaluate, catch: String }), {
    onFailure: (error) => ({ error }),
    onSuccess: (value) => ({ value }),
  })

const checkpoint = (sql: SqlStorage, sessionId: string) => ({
  e:
    Schema.decodeUnknownSync(Seqs)([
      ...sql.exec("select seq from event_sequence where aggregate_id = ?", sessionId),
    ]).at(0)?.seq ?? null,
  l: Schema.decodeUnknownSync(Ids)([
    ...sql.exec("select id from session_message where session_id = ? order by seq, id", sessionId),
  ]).map((row) => row.id),
})

const columns = (sql: SqlStorage, table: string) =>
  Schema.decodeUnknownSync(Names)([...sql.exec(`PRAGMA table_info(${table})`)]).map((row) => row.name)

const decode = (sql: SqlStorage, sessionId: string) => {
  const info = OpenCodeRows.session(sql.exec("select * from session_v2 where id = ?", sessionId).one())
  const rows = Schema.decodeUnknownSync(Schema.Array(Sync.OpenCodeMessageRow))([
    ...sql.exec(
      "select id, session_id, type, seq, data from session_message where session_id = ? order by seq, id",
      sessionId,
    ),
  ])
  return {
    session: { id: info.id, directory: info.location.directory, model: info.model?.id ?? null },
    messages: rows.map((row) => {
      const exit = OpenCodeRows.message(row)
      return {
        id: row.id,
        type: Exit.isSuccess(exit) ? exit.value.type : null,
        error: Exit.isFailure(exit) ? String(exit.cause) : null,
      }
    }),
  }
}

const read = (sql: SqlStorage, sessionId: string) => {
  const found = step(() =>
    Schema.decodeUnknownSync(Names)([
      ...sql.exec("select name from sqlite_master where type = 'table' and name in (?, ?, ?) order by name", ...tables),
    ]).map((row) => row.name),
  )
  if (!("value" in found) || found.value.length < tables.length) return { tables: found }
  return {
    tables: found,
    checkpoint: step(() => checkpoint(sql, sessionId)),
    columns: step(() => ({ session_v2: columns(sql, "session_v2"), session_message: columns(sql, "session_message") })),
    decoded: step(() => decode(sql, sessionId)),
  }
}

const sizes = (sql: SqlStorage, sessionId: string) => ({
  session: Schema.decodeUnknownSync(SessionState)(
    sql.exec("select time_suspended, idle_outcome from session_v2 where id = ?", sessionId).one(),
  ),
  messages: Schema.decodeUnknownSync(Schema.Array(Size))([
    ...sql.exec(
      "select id, type, seq, length(cast(data as blob)) as bytes from session_message where session_id = ? order by seq, id",
      sessionId,
    ),
  ]),
})

class SyncStorageCell extends SessionCell {
  readonly alarmReads: Array<ReturnType<typeof read> & { readonly isOpen: boolean }> = []
  watched = ""

  override async fetch(request: Request) {
    const url = new URL(request.url)
    this.watched = url.searchParams.get("session") ?? this.watched
    const sessionId = this.watched
    if (url.pathname === "/test/lose-storage") {
      await this.runtime.runPromise(Effect.flatMap(Harness.Service, (harness) => harness.close))
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.deleteAll()
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/test/watch") return new Response(null, { status: 204 })
    if (url.pathname === "/test/read") return Response.json(read(this.ctx.storage.sql, sessionId))
    if (url.pathname === "/test/sizes") return Response.json(sizes(this.ctx.storage.sql, sessionId))
    if (url.pathname === "/test/rows")
      return Response.json({
        sessions: [
          ...this.ctx.storage.sql.exec(
            `select ${Object.keys(Sync.OpenCodeSessionRow.fields).join(", ")} from session_v2`,
          ),
        ],
        messages: [
          ...this.ctx.storage.sql.exec(
            `select ${Object.keys(Sync.OpenCodeMessageRow.fields).join(", ")} from session_message`,
          ),
        ],
      })
    if (url.pathname === "/test/bind") {
      const text = "a".repeat(Number(url.searchParams.get("bytes")))
      return Response.json(step(() => this.ctx.storage.sql.exec("select length(?) as length", text).one().length))
    }
    if (url.pathname === "/test/alarm-reads") return Response.json(this.alarmReads)
    if (url.pathname === "/test/alarm") {
      await this.ctx.storage.setAlarm(Date.now())
      return new Response(null, { status: 204 })
    }
    return super.fetch(request)
  }

  override async alarm() {
    const state = await this.runtime.runPromise(
      Effect.gen(function* () {
        const harness = yield* Harness.Service
        return yield* harness.state
      }),
    )
    this.alarmReads.push({ isOpen: state.isOpen, ...read(this.ctx.storage.sql, this.watched) })
    return super.alarm()
  }
}

export { SyncStorageCell as SessionCell }

// oxlint-disable-next-line import/no-default-export -- celld and wrangler load the worker's default export
export default worker
