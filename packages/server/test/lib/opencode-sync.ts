export * as OpenCodeSyncTest from "./opencode-sync.js"

import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import { OpenCodeSync } from "@ren/opencode-transcript/opencode-sync"
import { SqliteReader } from "@ren/opencode-transcript/sqlite-reader"
import { Shared, type StubModel, SyncClient } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Seed } from "@ren/core/testing"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import type { Session as RenSession } from "@ren/schema/session"
import { Sync } from "@ren/schema/sync"
import { Clock, Effect, Logger, References, Schema } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hostToken } from "./app.js"
import { Proxy } from "./proxy.js"
import { SyncTest } from "./sync.js"

export const stub = Shared.stub()

export const folder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "opencode-sync-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
)

export const tokenFor = Effect.fnUntraced(function* (sid: RenSession.ID, org: Auth.OrganizationID, seconds: number) {
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  return yield* hostToken(Brain.ofSession(sid), org, { exp: now + seconds })
})

const sessionColumns = Object.keys(Sync.OpenCodeSessionRow.fields).join(", ")

const messageColumns = Object.keys(Sync.OpenCodeMessageRow.fields).join(", ")

const local = (db: Database, root: RenSession.ID) => {
  const sessions = Schema.decodeUnknownSync(Schema.Array(Sync.OpenCodeSessionRow))(
    db.query(`select ${sessionColumns} from session_v2`).all(),
  )
  const parents = new Map(sessions.map((session) => [session.id, session.parent_id]))
  const rootOf = (id: RenSession.ID): RenSession.ID => {
    const parent = parents.get(id)
    return parent ? rootOf(parent) : id
  }
  const scoped = new Set(sessions.filter((session) => rootOf(session.id) === root).map((session) => session.id))
  return {
    sessions: SyncTest.sortRows(
      sessions.filter((session) => scoped.has(session.id)),
      (session) => session.id,
    ),
    messages: SyncTest.sortRows(
      Schema.decodeUnknownSync(Schema.Array(Sync.OpenCodeMessageRow))(
        db.query(`select ${messageColumns} from session_message`).all(),
      ).filter((message) => scoped.has(message.session_id)),
      SyncTest.messageKey,
    ),
  }
}

export const paths = (requests: ReadonlyArray<Proxy.Request>) => requests.map((request) => request.path)

export const checkpoints = "/host/sync/checkpoints"

export const uploads = (id: string) => `/host/sync/sessions/${id}/uploads`

export const isStart = (id: string) => (request: Proxy.Request) => request.path === uploads(id)

export const isBatch = (id: string) => (request: Proxy.Request) =>
  request.path.startsWith(`${uploads(id)}/`) && request.path.endsWith("/messages")

export const isCommit = (id: string) => (request: Proxy.Request) =>
  request.path.startsWith(`${uploads(id)}/`) && request.path.endsWith("/commit")

export const nth = (count: number, match: (request: Proxy.Request) => boolean) => {
  const seen = { count: 0 }
  return (request: Proxy.Request) => match(request) && ++seen.count === count
}

export const logs = () => {
  const messages: Array<string> = []
  const annotations: Array<Readonly<Record<string, unknown>>> = []
  return {
    messages,
    annotations,
    layer: Logger.layer([
      Logger.make((options) => {
        messages.push([options.message].flat().map(String).join(" "))
        annotations.push(options.fiber.getRef(References.CurrentLogAnnotations))
      }),
    ]),
  }
}

export const renId = Schema.decodeUnknownSync(Sync.Checkpoint.fields.id)

export const setup = Effect.fnUntraced(function* (
  input: { readonly id?: RenSession.ID; readonly isStarted?: boolean } = {},
) {
  const file = join(yield* folder, "opencode.db")
  const brain = yield* SyncTest.isolated(BrainTest.make({ database: file, ...(input.id && { id: input.id }) }))
  if (input.isStarted ?? true) yield* brain.start({ interactive: false, title: "Sync" })
  const owner = yield* Seed.owner()
  yield* Seed.session(owner, { sessionId: brain.id })
  const server = yield* HttpServer.HttpServer
  const proxy = yield* Proxy.make(HttpServer.formatAddress(server.address))
  const token = { value: yield* tokenFor(brain.id, owner.organizationId, 600) }
  const host = { restoring: new Set<RenSession.ID>() }
  const db = new Database(file)
  yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))
  const reader = yield* SqliteReader.make(file)
  const driver = brain.driver
  const root = brain.id
  const sync = (input: { readonly reader?: OpenCodeSync.Reader; readonly version?: string } = {}) =>
    SyncClient.make(
      proxy.url,
      Effect.sync(() => token.value),
    ).pipe(
      Effect.flatMap((remote) =>
        OpenCodeSync.make({
          remote,
          reader: input.reader ?? reader,
          version: input.version ?? "2.0.27",
          restoring: Effect.sync(() => new Set(host.restoring)),
          mark: (id, state) =>
            Effect.sync(() => void (state.isRestoring ? host.restoring.add(id) : host.restoring.delete(id))),
        }),
      ),
      Effect.provide(FetchHttpClient.layer),
    )
  const create = (parentId?: RenSession.ID) => driver.create({ ...(parentId && { parentId }) })
  const turn = Effect.fnUntraced(function* (id: RenSession.ID, script: StubModel.Script = stub.script()) {
    yield* driver.prompt(id, `Go ${script.marker}`)
    yield* Effect.promise(() => script.called())
    yield* driver.wait(id)
  })
  const expectEqual = Effect.gen(function* () {
    const expected = local(db, brain.id)
    expect(yield* SyncTest.remote(brain.id)).toEqual(expected)
    return expected
  })
  return { brain, owner, root, proxy, token, host, db, reader, driver, sync, create, turn, expectEqual }
})
