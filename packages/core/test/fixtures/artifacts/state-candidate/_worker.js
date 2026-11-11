/* oxlint-disable import/no-default-export, typescript/no-unsafe-argument, typescript/no-unsafe-member-access, typescript/no-unsafe-assignment, typescript/no-unsafe-return, typescript/no-unsafe-call, eslint/complexity -- Executable JavaScript fixture: Cloudflare supplies Worker/SQLite/WebSocket runtime types unavailable to the host project. Keep the small candidate router self-contained; the Worker entry requires a default export. */
import { DurableObject } from "cloudflare:workers"

const migrations = [
  {
    id: 1,
    sql: "CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, text TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL);",
  },
]

function migrate(storage, migrations) {
  storage.transactionSync(() => {
    const sql = storage.sql
    sql.exec("CREATE TABLE IF NOT EXISTS app_migrations (id INTEGER PRIMARY KEY, sql TEXT NOT NULL)")
    const applied = sql.exec("SELECT id, sql FROM app_migrations ORDER BY id").toArray()
    if (applied.length > migrations.length) throw new Error("Database schema is newer than this application")
    let index = 0
    for (const migration of migrations) {
      if (migration.id !== index + 1 || typeof migration.sql !== "string" || !migration.sql.trim())
        throw new Error("Migrations must have contiguous IDs starting at 1 and non-empty SQL")
      const existing = applied.at(index)
      index += 1
      if (existing) {
        if (existing.id !== migration.id || existing.sql !== migration.sql)
          throw new Error("Applied migrations are immutable")
        continue
      }
      sql.exec(migration.sql)
      sql.exec("INSERT INTO app_migrations (id, sql) VALUES (?, ?)", migration.id, migration.sql)
    }
  })
}

export class SampleState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    migrate(ctx.storage, migrations)
  }
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/api/schema")
      return Response.json({
        version: this.sql.exec("SELECT COUNT(*) AS version FROM app_migrations").one().version,
        entries: this.sql.exec("SELECT * FROM entries ORDER BY id").toArray(),
      })
    if (path === "/room") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
        return new Response("WebSocket required", { status: 426 })
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1])
      return new Response(null, { status: 101, webSocket: pair[0] })
    }
    if (path === "/api/messages")
      return Response.json(this.sql.exec("SELECT id, text FROM messages ORDER BY id").toArray())
    if (path === "/api/entries" && request.method === "GET")
      return Response.json({
        version: typeof SAMPLE_VERSION === "undefined" ? "1" : SAMPLE_VERSION,
        entries: this.sql.exec("SELECT id, text FROM entries ORDER BY id").toArray(),
      })
    const id = path.match(/^\/api\/entries\/([a-zA-Z0-9-]{1,64})$/)?.[1]
    if (!id) return new Response("Not found", { status: 404 })
    if (request.method === "DELETE") {
      this.sql.exec("DELETE FROM entries WHERE id = ?", id)
      return new Response(null, { status: 204 })
    }
    if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 })
    const input = await request.json().catch(() => null)
    if (typeof input?.text !== "string" || !input.text.trim() || input.text.length > 500)
      return Response.json({ error: "Write 1–500 characters" }, { status: 400 })
    this.sql.exec(
      "INSERT INTO entries (id, text) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET text = excluded.text",
      id,
      input.text.trim(),
    )
    return Response.json({ id, text: input.text.trim() })
  }
  webSocketMessage(socket, text) {
    if (typeof text !== "string" || !text.trim() || text.length > 500) {
      socket.send(JSON.stringify({ error: "Write 1–500 characters" }))
      return
    }
    const message = this.sql.exec("INSERT INTO messages (text) VALUES (?) RETURNING id, text", text.trim()).one()
    for (const peer of this.ctx.getWebSockets()) peer.send(JSON.stringify(message))
  }
}

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname
    if (path.startsWith("/api/") || path === "/room")
      return env.STATE.get(env.STATE.idFromName("shared-sample")).fetch(request)
    return env.ASSETS.fetch(request)
  },
}
