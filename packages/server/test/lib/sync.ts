export * as SyncTest from "./sync.js"

import { test } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import type { Sync } from "@ren/schema/sync"
import { Session } from "@ren/core/session"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import { Effect, Layer, type Scope, Struct } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { Routes } from "../../src/routes.js"
import { environment, services } from "./app.js"

const make = (cellURL?: string) =>
  Layer.mergeAll(
    Layer.effect(HttpServer.HttpServer, HttpServer.HttpServer).pipe(
      Layer.provide(
        HttpRouter.serve(Routes.layer, { disableListenLog: true, disableLogger: true }).pipe(
          Layer.provideMerge(BunHttpServer.layer({ hostname: "127.0.0.1", port: 0 })),
        ),
      ),
    ),
    Session.layer,
  ).pipe(
    Layer.provideMerge(services),
    Layer.provide(FetchHttpClient.layer),
    Layer.provideMerge(Testing.layer),
    Layer.provide(environment(undefined, cellURL ? { CELL_URL: cellURL } : undefined)),
  )

export type Services = Layer.Success<ReturnType<typeof make>> | Scope.Scope

// oxlint-disable-next-line ren/no-comments -- The core testEffect provides a Fetch that refuses other hosts. A Fetch in the caller's context replaces the one that the embedded OpenCode client uses, so these tests run without it, as the cell tests do. The layer hides the router of the Ren server, and a host gets its own memo map, so that the host does not reuse the router and the HTTP client of the Ren server.
export const live = <A, E>(
  name: string,
  body: () => Effect.Effect<A, E, Services>,
  timeout?: number,
  cellURL?: () => string,
) =>
  test(
    name,
    () =>
      body().pipe(Effect.scoped, Effect.provide(Layer.unwrap(Effect.sync(() => make(cellURL?.())))), Effect.runPromise),
    timeout,
  )

export const isolated = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(Layer.CurrentMemoMap, Layer.makeMemoMapUnsafe()))

export const sortRows = <A>(rows: ReadonlyArray<A>, key: (row: A) => string) =>
  rows.toSorted((left, right) => (key(left) < key(right) ? -1 : 1))

export const messageKey = (row: Sync.OpenCodeMessageRow) =>
  `${row.session_id} ${String(row.seq).padStart(16, "0")} ${row.id}`

export const remote = Effect.fnUntraced(function* (root: Session.ID) {
  const database = yield* Database.Service
  const sessions = yield* database.db
    .select({ opencode: Database.Schema.opencode_session, parentId: Database.Schema.agent_session.parent_id })
    .from(Database.Schema.opencode_session)
    .innerJoin(
      Database.Schema.agent_session,
      eq(Database.Schema.agent_session.id, Database.Schema.opencode_session.session_id),
    )
    .where(eq(Database.Schema.agent_session.root_id, root))
  const messages = yield* database.db
    .select({
      id: Database.Schema.opencode_message.id,
      session_id: Database.Schema.opencode_message.session_id,
      type: Database.Schema.opencode_message.type,
      seq: Database.Schema.opencode_message.seq,
      data: Database.Schema.opencode_message.data,
    })
    .from(Database.Schema.opencode_message)
    .innerJoin(
      Database.Schema.agent_session,
      eq(Database.Schema.agent_session.id, Database.Schema.opencode_message.session_id),
    )
    .where(eq(Database.Schema.agent_session.root_id, root))
  return {
    sessions: sortRows(
      sessions.map((row) =>
        Object.assign(Struct.omit(row.opencode, ["session_id"]), {
          id: row.opencode.session_id,
          parent_id: row.parentId,
        }),
      ),
      (session) => session.id,
    ),
    messages: sortRows(messages, messageKey),
  }
})

export const status = (id: string) =>
  Effect.flatMap(Session.Service, (sessions) => sessions.get(Session.ID.make(id))).pipe(
    Effect.map((info) => info.status),
  )
