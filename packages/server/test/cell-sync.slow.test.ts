import { afterAll, beforeAll, describe, expect } from "bun:test"
import { SQL } from "bun"
import { OpenCode } from "@opencode/client"
import { SessionToken } from "@ren/host-api/session-token"
import { Sync } from "@ren/schema/sync"
import { Celld, Shared, TestToken } from "@ren/cell/testing"
import { BrainHost } from "@ren/core/brain-host"
import { Session } from "@ren/core/session"
import { Seed } from "@ren/core/testing"
import { Brain } from "@ren/schema/brain"
import type { Database } from "@ren/db/database"
import { Deferred, Effect, Queue, Redacted, Schema } from "effect"
import { HttpServer } from "effect/http"
import { SqlClient } from "effect/sql"
import { cellKey } from "./lib/app.js"
import { Proxy } from "./lib/proxy.js"
import { SyncTest } from "./lib/sync.js"

const stub = Shared.stub()

const ren = { port: 0 }

const state: { celld: Celld.Instance | undefined } = { celld: undefined }

const celld = () => {
  if (!state.celld) throw new Error("celld did not start")
  return state.celld
}

beforeAll(async () => {
  const probe = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: () => new Response(null) })
  ren.port = probe.port ?? 0
  await probe.stop(true)
  state.celld = await Celld.make(
    {
      ...Shared.vars(),
      CELL_KEYS: JSON.stringify([cellKey]),
      REN_URL: `http://host.docker.internal:${ren.port}`,
    },
    "test/lib/sync-storage-worker.ts",
  )
}, 180_000)

afterAll(async () => {
  await state.celld?.dispose()
})

const it = {
  live: <A, E>(name: string, body: () => Effect.Effect<A, E, SyncTest.Services>) =>
    SyncTest.live(name, body, 180_000, () => celld().url),
}

const Rows = Schema.Struct({
  sessions: Schema.Array(Sync.OpenCodeSessionRow),
  messages: Schema.Array(Sync.OpenCodeMessageRow),
})

const checkpoints = "/host/sync/checkpoints"

const uploads = (id: string) => `/host/sync/sessions/${id}/uploads/`

const seconds = (offset: number) => Math.floor(Date.now() / 1000) + offset

const types = (rows: { readonly messages: ReadonlyArray<Sync.OpenCodeMessageRow> }) =>
  rows.messages.map((row) => row.type)

const setup = Effect.fnUntraced(function* () {
  const server = yield* HttpServer.HttpServer
  const proxy = yield* Proxy.make(HttpServer.formatAddress(server.address), { hostname: "0.0.0.0", port: ren.port })
  const owner = yield* Seed.owner()
  yield* Seed.ren()
  const sessions = yield* Session.Service
  const brain = yield* BrainHost.Service
  const id = Session.ID.create()
  const client = TestToken.basic(yield* SessionToken.sign(cellKey, { sid: id, scope: "client", exp: seconds(3600) }))
  const opencode = OpenCode.make({ baseUrl: celld().url, headers: { authorization: client } })
  const commits = yield* Queue.unbounded<void>()
  proxy.observe((request, status) => {
    if (request.path.startsWith(uploads(id)) && request.path.endsWith("/commit") && status < 300)
      Queue.offerUnsafe(commits, undefined)
  })
  const local = Effect.promise(async () => {
    const response = await fetch(`${celld().url}/test/rows`, { headers: { authorization: client } })
    const rows = Schema.decodeUnknownSync(Rows)(await response.json())
    return {
      sessions: SyncTest.sortRows(rows.sessions, (session) => session.id),
      messages: SyncTest.sortRows(rows.messages, SyncTest.messageKey),
    }
  })
  const idle = Effect.promise(() => opencode.session.wait({ sessionID: id }))
  const message = (text: string) => ({
    messageId: Session.MessageID.create(),
    prompt: { text },
    sender: { userId: owner.createdBy },
  })
  const create = (text: string) =>
    sessions.create(owner, {
      sessionId: id,
      harness: "opencode",
      title: "Sync",
      interactive: false,
      initialMessage: message(text),
    })
  const held = (script: { readonly release: () => void }) => Effect.addFinalizer(() => Effect.sync(script.release))
  const converged = (done: (rows: Effect.Success<typeof local>) => boolean = (rows) => rows.messages.length > 0) => {
    const check: Effect.Effect<Effect.Success<typeof local>, never, Database.Service> = Effect.gen(function* () {
      const expected = yield* local
      const actual = yield* SyncTest.remote(id).pipe(Effect.retry({ times: 3 }), Effect.orDie)
      if (done(expected) && Bun.deepEquals(actual, expected)) return expected
      yield* Queue.take(commits)
      return yield* check
    })
    return check.pipe(
      Effect.timeout("120 seconds"),
      Effect.catchTag("TimeoutError", () =>
        Effect.gen(function* () {
          const expected = yield* local
          expect(yield* SyncTest.remote(id)).toEqual(expected)
          return yield* Effect.die(new Error("Postgres did not become equal to the cell"))
        }),
      ),
    )
  }
  return { proxy, owner, brain, id, opencode, local, idle, message, create, held, converged }
})

const restart = Effect.promise(async () => {
  await celld().kill()
  await celld().start()
})

const connections = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const name = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ name: Schema.String })]))(
    yield* sql`select current_database() as name`,
  )[0].name
  const allow = (allowed: boolean) =>
    Effect.promise(async () => {
      const admin = new SQL(process.env.DATABASE_URL ?? "postgres://ren:ren@localhost:54320/ren")
      await admin.unsafe(`alter database "${name}" allow_connections ${allowed}`)
      if (!allowed) await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${name}`
      await admin.close()
    })
  yield* Effect.addFinalizer(() => allow(true))
  return allow
})

const status = Effect.fnUntraced(function* (proxy: Effect.Success<ReturnType<typeof setup>>["proxy"], path: string) {
  const answered = yield* Deferred.make<number>()
  proxy.once({
    match: (request) => request.path === path,
    after: (response) => Effect.runPromise(Deferred.succeed(answered, response.status)),
  })
  return Deferred.await(answered)
})

describe("cell sync", () => {
  it.live("a turn, then flush: Postgres is equal to the cell", () =>
    Effect.gen(function* () {
      const cell = yield* setup()
      yield* cell.create(`go ${stub.script().marker}`)
      yield* cell.idle
      expect(yield* cell.brain.flush(cell.id, cell.owner.organizationId)).toEqual({ drained: true })
      const expected = yield* cell.local
      expect(yield* SyncTest.remote(cell.id)).toEqual(expected)
      expect(types(expected)).toEqual(["user", "assistant", "idle"])
    }),
  )

  it.live(
    "stop the Ren server during a turn. Start it after the turn. Postgres becomes equal to the cell with no client request",
    () =>
      Effect.gen(function* () {
        const cell = yield* setup()
        const script = stub.script({ hold: true })
        yield* cell.held(script)
        yield* cell.create(`go ${script.marker}`)
        yield* Effect.promise(() => script.called())
        yield* Effect.promise(cell.proxy.down)
        script.release()
        yield* cell.idle
        expect(types(yield* SyncTest.remote(cell.id))).not.toContain("idle")
        cell.proxy.up()
        yield* cell.converged((rows) => types(rows).includes("idle"))
      }),
  )

  it.live(
    "Ren cannot reach Postgres during a turn. After Postgres is back, Postgres becomes equal to the cell with no client request",
    () =>
      Effect.gen(function* () {
        const cell = yield* setup()
        const allow = yield* connections
        const script = stub.script({ hold: true })
        yield* cell.held(script)
        yield* cell.create(`go ${script.marker}`)
        yield* Effect.promise(() => script.called())
        yield* allow(false)
        const refused = yield* status(cell.proxy, checkpoints)
        script.release()
        yield* cell.idle
        expect(yield* refused).toBeGreaterThanOrEqual(500)
        yield* allow(true)
        yield* cell.converged((rows) => types(rows).includes("idle"))
      }),
  )

  it.live("kill celld during a turn. Start it again. Postgres becomes equal to the cell", () =>
    Effect.gen(function* () {
      const cell = yield* setup()
      const script = stub.script({ hold: true })
      yield* cell.held(script)
      yield* cell.create(`go ${script.marker}`)
      yield* Effect.promise(() => script.called())
      yield* restart
      script.release()
      yield* cell.converged((rows) => types(rows).includes("idle"))
    }),
  )

  it.live(
    "kill celld during a pass. Start it again. Postgres becomes equal to the cell, and a late batch of the old upload gets StaleUploadError",
    () =>
      Effect.gen(function* () {
        const cell = yield* setup()
        yield* cell.create(`go ${stub.script().marker}`)
        yield* cell.idle
        yield* cell.converged()
        const entered = yield* Deferred.make<void>()
        const held = Promise.withResolvers<void>()
        yield* Effect.addFinalizer(() => Effect.sync(held.resolve))
        const late = yield* Deferred.make<{ readonly status: number; readonly body: unknown }>()
        cell.proxy.once({
          match: (request) => request.path.startsWith(uploads(cell.id)) && request.path.endsWith("/messages"),
          before: () => Effect.runPromise(Deferred.succeed(entered, undefined)).then(() => held.promise),
          after: async (response) =>
            Effect.runPromise(Deferred.succeed(late, { status: response.status, body: await response.json() })),
        })
        yield* Effect.promise(() => cell.opencode.session.update({ sessionID: cell.id, title: "Renamed" }))
        yield* Deferred.await(entered)
        yield* restart
        const synced = yield* cell.converged((rows) => rows.sessions.every((session) => session.title === "Renamed"))
        held.resolve()
        expect(yield* Deferred.await(late)).toMatchObject({ status: 409, body: { _tag: "StaleUploadError" } })
        expect(yield* SyncTest.remote(cell.id)).toEqual(synced)
      }),
  )

  it.live("let the host token expire while Ren is down. The next call from Ren completes the sync", () =>
    Effect.gen(function* () {
      const cell = yield* setup()
      cell.proxy.block((request) => request.path !== "/host/settings")
      yield* Seed.session(cell.owner, { sessionId: cell.id })
      const server = TestToken.basic(
        yield* SessionToken.sign(cellKey, { sid: cell.id, scope: "server", exp: seconds(600) }),
      )
      const expired = yield* SessionToken.sign(cellKey, {
        sid: cell.id,
        scope: "host",
        org: cell.owner.organizationId,
        iat: seconds(-660),
        exp: seconds(-60),
      })
      const valid = yield* SessionToken.sign(cellKey, {
        sid: cell.id,
        scope: "host",
        org: cell.owner.organizationId,
        iat: seconds(0),
        exp: seconds(600),
      })
      const call = (method: string, path: string, body: unknown, hostToken = valid) =>
        Effect.promise(async () => {
          const response = await fetch(`${celld().url}${path}`, {
            method,
            headers: { authorization: server, "content-type": "application/json", "ren-host-token": hostToken },
            body: JSON.stringify(body),
          })
          if (!response.ok) throw new Error(`${path} answered ${response.status}: ${await response.text()}`)
        })
      yield* call("PUT", "/ren/models", Schema.encodeSync(Brain.ModelGrant)({ access: Shared.access() }))
      yield* Effect.promise(() => cell.opencode.session.create({ id: cell.id, location: { directory: "/workspace" } }))
      yield* call("POST", "/ren/sessions", {
        sessionId: cell.id,
        harness: "opencode",
        title: "Sync",
        interactive: false,
        initialMessage: cell.message(`go ${stub.script().marker}`),
      })
      yield* cell.idle
      yield* call(
        "PUT",
        "/ren/models",
        Schema.encodeSync(Brain.ModelGrant)({ access: Shared.access(), hostToken: Redacted.make(expired) }),
        expired,
      )
      const refused = yield* status(cell.proxy, checkpoints)
      cell.proxy.unblock()
      expect(yield* refused).toBe(403)
      expect(yield* SyncTest.remote(cell.id)).toEqual({ sessions: [], messages: [] })
      expect(yield* cell.brain.flush(cell.id, cell.owner.organizationId)).toEqual({ drained: true })
      expect(yield* SyncTest.remote(cell.id)).toEqual(yield* cell.local)
    }),
  )
})
