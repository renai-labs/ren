import { afterAll, beforeAll, expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { SyncUnavailableError } from "@ren/brain-api/errors"
import { SessionToken } from "@ren/brain-api/session-token"
import { OpenCodeMessageRow, OpenCodeSessionRow } from "@ren/brain-api/sync-api"
import { Celld, Shared, TestToken } from "@ren/cell/testing"
import { BrainHost } from "@ren/core/brain-host"
import { Session } from "@ren/core/session"
import { Seed } from "@ren/core/testing"
import { Deferred, Effect, Fiber, Schema } from "effect"
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
    { ...Shared.vars(), CELL_KEYS: JSON.stringify([cellKey]), REN_URL: `http://host.docker.internal:${ren.port}` },
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

const Rows = Schema.Struct({ sessions: Schema.Array(OpenCodeSessionRow), messages: Schema.Array(OpenCodeMessageRow) })

const setup = Effect.fnUntraced(function* () {
  const server = yield* HttpServer.HttpServer
  const proxy = yield* Proxy.make(HttpServer.formatAddress(server.address), { hostname: "0.0.0.0", port: ren.port })
  const owner = yield* Seed.owner()
  const sessions = yield* Session.Service
  const brain = yield* BrainHost.Service
  const id = Session.ID.create()
  const authorization = TestToken.basic(
    yield* SessionToken.sign(cellKey, {
      sid: id,
      scope: "client",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
  const opencode = OpenCode.make({ baseUrl: celld().url, headers: { authorization } })
  const input = {
    sessionId: id,
    harness: "opencode" as const,
    title: "Restore",
    instructions: {},
    interactive: false,
    initialMessage: {
      messageId: Session.MessageID.create(),
      prompt: { text: `go ${stub.script().marker}` },
      sender: { userId: owner.createdBy },
    },
  }
  const local = Effect.promise(async () => {
    const response = await fetch(`${celld().url}/test/rows`, { headers: { authorization } })
    const rows = Schema.decodeUnknownSync(Rows)(await response.json())
    return {
      sessions: SyncTest.sortRows(rows.sessions, (row) => row.id),
      messages: SyncTest.sortRows(rows.messages, SyncTest.messageKey),
    }
  })
  const lose = Effect.promise(async () => {
    const response = await fetch(`${celld().url}/test/lose-storage`, { headers: { authorization } })
    expect(response.status).toBe(204)
    await celld().kill()
    await celld().start()
  })
  yield* sessions.create(owner, input)
  yield* Effect.promise(() => opencode.session.wait({ sessionID: id }))
  return { proxy, owner, sessions, brain, id, input, opencode, local, lose }
})

it.live(
  "P5-01: storage loss restores the root and child, continues the session, and syncs the imported sequences",
  () =>
    Effect.gen(function* () {
      const cell = yield* setup()
      const child = yield* Effect.promise(() =>
        cell.opencode.session.create({ parentID: cell.id, location: { directory: "/workspace" } }),
      )
      yield* Effect.promise(() =>
        cell.opencode.session.prompt({ sessionID: child.id, text: `child ${stub.script().marker}` }),
      )
      yield* Effect.promise(() => cell.opencode.session.wait({ sessionID: child.id }))
      expect(yield* cell.brain.flush(cell.id, cell.owner.organizationId)).toEqual({ drained: true })
      const before = yield* cell.local
      yield* cell.lose
      yield* cell.brain.start(cell.input, cell.owner.organizationId)
      const restored = yield* cell.local
      expect(restored.sessions.map((row) => row.id)).toEqual(before.sessions.map((row) => row.id))
      expect(restored.messages.map((row) => row.id).toSorted()).toEqual(before.messages.map((row) => row.id).toSorted())
      yield* cell.brain.send(
        {
          sessionId: cell.id,
          delivery: "queue",
          messageId: Session.MessageID.create(),
          prompt: { text: `next ${stub.script().marker}` },
          sender: { userId: cell.owner.createdBy },
        },
        cell.owner.organizationId,
      )
      yield* Effect.promise(() => cell.opencode.session.wait({ sessionID: cell.id }))
      expect(yield* cell.brain.flush(cell.id, cell.owner.organizationId)).toEqual({ drained: true })
      expect(yield* SyncTest.remote(cell.id)).toEqual(yield* cell.local)
    }),
)

it.live("P5-02: unavailable Ren fails start without making an empty session, and BrainHost retries restore", () =>
  Effect.gen(function* () {
    const cell = yield* setup()
    yield* cell.brain.flush(cell.id, cell.owner.organizationId)
    const before = yield* cell.local
    yield* cell.lose
    yield* Effect.promise(cell.proxy.down)
    const refused = yield* Effect.flip(cell.brain.start(cell.input, cell.owner.organizationId))
    expect(refused instanceof BrainHost.BrainUnavailable && refused.cause).toBeInstanceOf(SyncUnavailableError)
    expect((yield* cell.local).sessions).toEqual([])
    cell.proxy.up()
    cell.proxy.once({ match: (request) => request.path === "/brain/sync/restore", fault: "fail" })
    yield* cell.brain.start(cell.input, cell.owner.organizationId)
    expect((yield* cell.local).messages.map((row) => row.id)).toEqual(before.messages.map((row) => row.id))
  }),
)

it.live("P5-03: a kill between parent and child imports resumes with only the missing child", () =>
  Effect.gen(function* () {
    const cell = yield* setup()
    const child = yield* Effect.promise(() =>
      cell.opencode.session.create({ parentID: cell.id, location: { directory: "/workspace" } }),
    )
    yield* cell.brain.flush(cell.id, cell.owner.organizationId)
    yield* cell.lose
    cell.proxy.clear()
    const entered = yield* Deferred.make<void>()
    const held = Promise.withResolvers<void>()
    yield* Effect.addFinalizer(() => Effect.sync(held.resolve))
    cell.proxy.once({
      match: (request) => request.path === `/brain/sync/sessions/${child.id}/messages`,
      before: () => Effect.runPromise(Deferred.succeed(entered, undefined)).then(() => held.promise),
    })
    const starting = yield* Effect.forkChild(Effect.exit(cell.brain.start(cell.input, cell.owner.organizationId)))
    yield* Deferred.await(entered)
    expect((yield* cell.local).sessions.map((row) => row.id)).toEqual([cell.id])
    yield* Effect.promise(() => celld().kill())
    held.resolve()
    yield* Fiber.join(starting)
    yield* Effect.promise(() => celld().start())
    yield* cell.brain.start(cell.input, cell.owner.organizationId)
    expect((yield* cell.local).sessions).toHaveLength(2)
    expect(
      cell.proxy.requests.filter((request) => request.path === `/brain/sync/sessions/${cell.id}/messages`),
    ).toHaveLength(1)
    expect(yield* cell.brain.flush(cell.id, cell.owner.organizationId)).toEqual({ drained: true })
    expect(yield* SyncTest.remote(cell.id)).toEqual(yield* cell.local)
  }),
)

it.live("P5-04: restore invalidates a late batch from the lost cell", () =>
  Effect.gen(function* () {
    const cell = yield* setup()
    yield* cell.brain.flush(cell.id, cell.owner.organizationId)
    const token = yield* SessionToken.sign(cellKey, {
      sid: cell.id,
      scope: "host",
      org: cell.owner.organizationId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const request = (path: string, body: unknown) =>
      Effect.promise(() =>
        fetch(`${cell.proxy.url}/brain/sync/sessions/${cell.id}/uploads${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      )
    const response = yield* request("", { harness: "opencode", parentId: null })
    const upload = yield* Effect.promise(async () =>
      Schema.decodeUnknownSync(Schema.Struct({ upload: Schema.Int }))(await response.json()),
    )
    yield* cell.lose
    yield* cell.brain.start(cell.input, cell.owner.organizationId)
    const late = yield* request(`/${upload.upload}/messages`, { messages: [] })
    expect(late.status).toBe(409)
    expect(yield* Effect.promise(() => late.json())).toMatchObject({ _tag: "StaleUploadError" })
  }),
)

it.live("P5-05: an uncommitted root is created before its committed child is imported", () =>
  Effect.gen(function* () {
    const cell = yield* setup()
    const child = yield* Effect.promise(() =>
      cell.opencode.session.create({ parentID: cell.id, location: { directory: "/workspace" } }),
    )
    yield* cell.brain.flush(cell.id, cell.owner.organizationId)
    const sql = yield* SqlClient.SqlClient
    yield* sql`delete from opencode_session where session_id = ${cell.id}`
    yield* cell.lose
    yield* cell.brain.start(cell.input, cell.owner.organizationId)
    expect((yield* cell.local).sessions.map((row) => row.id).toSorted()).toEqual(
      [cell.id, Session.ID.make(child.id)].toSorted(),
    )
    yield* Effect.promise(() => cell.opencode.session.wait({ sessionID: cell.id }))
  }),
)

it.live("P5-06: restore skips descendants of a missing parent and restores other children", () =>
  Effect.gen(function* () {
    const cell = yield* setup()
    const create = (parentID: string) =>
      Effect.promise(() => cell.opencode.session.create({ parentID, location: { directory: "/workspace" } }))
    const missing = yield* create(cell.id)
    const skipped = yield* create(missing.id)
    const sibling = yield* create(cell.id)
    yield* cell.brain.flush(cell.id, cell.owner.organizationId)
    const sql = yield* SqlClient.SqlClient
    yield* sql`delete from opencode_session where session_id = ${missing.id}`
    yield* cell.lose
    yield* cell.brain.start(cell.input, cell.owner.organizationId)
    expect((yield* cell.local).sessions.map((row) => row.id).toSorted()).toEqual(
      [cell.id, Session.ID.make(sibling.id)].toSorted(),
    )
    expect((yield* SyncTest.remote(cell.id)).sessions.map((row) => row.id)).toContain(Session.ID.make(skipped.id))
  }),
)

it.live("P5-07: send restores through saved start_input and does not resubmit an accepted message ID", () =>
  Effect.gen(function* () {
    const cell = yield* setup()
    yield* cell.brain.flush(cell.id, cell.owner.organizationId)
    const before = yield* cell.local
    yield* cell.lose
    yield* cell.sessions.send({ sessionId: cell.id, delivery: "queue", ...cell.input.initialMessage })
    expect((yield* cell.local).messages.map((row) => row.id)).toEqual(before.messages.map((row) => row.id))
  }),
)

it.live("P5-09: a busy session restores as idle and the next pass updates Ren", () =>
  Effect.gen(function* () {
    const cell = yield* setup()
    const script = stub.script({ hold: true })
    yield* Effect.addFinalizer(() => Effect.sync(script.release))
    yield* cell.brain.send(
      {
        sessionId: cell.id,
        delivery: "queue",
        messageId: Session.MessageID.create(),
        prompt: { text: `busy ${script.marker}` },
        sender: { userId: cell.owner.createdBy },
      },
      cell.owner.organizationId,
    )
    yield* Effect.promise(() => script.called())
    yield* cell.brain.flush(cell.id, cell.owner.organizationId)
    expect(yield* SyncTest.status(cell.id)).toBe("busy")
    yield* cell.lose
    script.release()
    yield* cell.brain.start(cell.input, cell.owner.organizationId)
    expect((yield* cell.local).sessions[0]?.time_suspended).toBeNull()
    expect(yield* cell.brain.flush(cell.id, cell.owner.organizationId)).toEqual({ drained: true })
    expect(yield* SyncTest.status(cell.id)).toBe("idle")
  }),
)
