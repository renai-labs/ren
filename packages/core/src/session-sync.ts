export * as SessionSync from "./session-sync.js"

import { ForbiddenError, StaleUploadError } from "@ren/brain-api/errors"
import type { CurrentHost } from "@ren/brain-api/host-api"
import type { OpenCodeMessageRow, OpenCodeSessionRow } from "@ren/brain-api/sync-api"
import { Database } from "@ren/db/database"
import type { Session } from "@ren/schema/session"
import { and, asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { OpenCodeStore } from "./session/opencode-store.js"

export { ForbiddenError, StaleUploadError } from "@ren/brain-api/errors"

export type Host = CurrentHost["Service"]

export type Cursor = OpenCodeStore.Cursor

export interface Checkpoint {
  readonly id: Session.ID
  readonly syncSeq: number | null
  readonly timeSuspended: number | null
}

export interface Page {
  readonly messages: ReadonlyArray<OpenCodeMessageRow>
  readonly next: Cursor | null
}

export interface Interface {
  readonly checkpoints: (host: Host) => Effect.Effect<ReadonlyArray<Checkpoint>>
  readonly startUpload: (
    host: Host,
    sessionId: Session.ID,
    input: { readonly harness: Session.Harness; readonly parentId: Session.ID | null },
  ) => Effect.Effect<number, ForbiddenError>
  readonly uploadMessages: (
    host: Host,
    sessionId: Session.ID,
    upload: number,
    messages: ReadonlyArray<OpenCodeMessageRow>,
  ) => Effect.Effect<void, ForbiddenError | StaleUploadError>
  readonly commit: (
    host: Host,
    sessionId: Session.ID,
    upload: number,
    input: { readonly session: OpenCodeSessionRow; readonly seq: number; readonly ids: ReadonlyArray<string> },
  ) => Effect.Effect<void, ForbiddenError | StaleUploadError>
  readonly restore: (
    host: Host,
    sessionId: Session.ID,
  ) => Effect.Effect<ReadonlyArray<OpenCodeSessionRow>, ForbiddenError>
  readonly messages: (
    host: Host,
    sessionId: Session.ID,
    input: { readonly after?: Cursor | undefined; readonly limit: number },
  ) => Effect.Effect<Page, ForbiddenError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SessionSync") {}

const forbidden = new ForbiddenError({ message: "The session is not in the scope of the host token" })

const stale = new StaleUploadError({ message: "The upload is not the current open upload of the session" })

const inScope = (host: Host) =>
  and(
    eq(Database.Schema.agent_session.root_id, host.brainId),
    eq(Database.Schema.agent_session.organization_id, host.organizationId),
  )

const lock = Effect.fnUntraced(function* (transaction: Database.Transaction, host: Host, sessionId: Session.ID) {
  const row = (yield* transaction
    .select()
    .from(Database.Schema.agent_session)
    .where(and(eq(Database.Schema.agent_session.id, sessionId), inScope(host)))
    .for("update")).at(0)
  if (!row) return yield* forbidden
  return row
})

const open = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  host: Host,
  sessionId: Session.ID,
  upload: number,
) {
  const row = yield* lock(transaction, host, sessionId)
  if (row.sync_upload !== upload || !row.sync_upload_open) return yield* stale
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service

    return Service.of({
      checkpoints: Effect.fn("SessionSync.checkpoints")(function* (host: Host) {
        return yield* database.transaction((transaction) =>
          transaction
            .select({
              id: Database.Schema.agent_session.id,
              syncSeq: Database.Schema.agent_session.sync_seq,
              timeSuspended: OpenCodeStore.summary.timeSuspended,
            })
            .from(Database.Schema.agent_session)
            .leftJoin(Database.Schema.opencode_session, OpenCodeStore.join)
            .where(inScope(host))
            .orderBy(asc(Database.Schema.agent_session.created_at), asc(Database.Schema.agent_session.id)),
        )
      }),
      startUpload: Effect.fn("SessionSync.startUpload")(function* (
        host: Host,
        sessionId: Session.ID,
        input: { readonly harness: Session.Harness; readonly parentId: Session.ID | null },
      ) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const existing = yield* transaction
              .select({ id: Database.Schema.agent_session.id })
              .from(Database.Schema.agent_session)
              .where(eq(Database.Schema.agent_session.id, sessionId))
              .for("update")
            if (existing.length === 0) {
              if (!input.parentId) return yield* forbidden
              const parent = (yield* transaction
                .select()
                .from(Database.Schema.agent_session)
                .where(and(eq(Database.Schema.agent_session.id, input.parentId), inScope(host)))).at(0)
              if (!parent) return yield* forbidden
              yield* transaction
                .insert(Database.Schema.agent_session)
                .values({
                  id: sessionId,
                  organization_id: parent.organization_id,
                  space_id: parent.space_id,
                  created_by: parent.created_by,
                  parent_id: parent.id,
                  root_id: parent.root_id,
                  harness: input.harness,
                })
                .onConflictDoNothing()
            }
            const opened = (yield* transaction
              .update(Database.Schema.agent_session)
              .set({ sync_upload: sql`${Database.Schema.agent_session.sync_upload} + 1`, sync_upload_open: true })
              .where(and(eq(Database.Schema.agent_session.id, sessionId), inScope(host)))
              .returning({ upload: Database.Schema.agent_session.sync_upload })).at(0)
            if (!opened) return yield* forbidden
            return opened.upload
          }),
        )
      }),
      uploadMessages: Effect.fn("SessionSync.uploadMessages")(function* (
        host: Host,
        sessionId: Session.ID,
        upload: number,
        messages: ReadonlyArray<OpenCodeMessageRow>,
      ) {
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* open(transaction, host, sessionId, upload)
            if (messages.some((message) => message.session_id !== sessionId)) return yield* forbidden
            yield* OpenCodeStore.writeMessages(transaction, messages)
          }),
        )
      }),
      commit: Effect.fn("SessionSync.commit")(function* (
        host: Host,
        sessionId: Session.ID,
        upload: number,
        input: { readonly session: OpenCodeSessionRow; readonly seq: number; readonly ids: ReadonlyArray<string> },
      ) {
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* open(transaction, host, sessionId, upload)
            if (input.session.id !== sessionId) return yield* forbidden
            yield* OpenCodeStore.writeSession(transaction, input.session)
            yield* OpenCodeStore.keepMessages(transaction, sessionId, input.ids)
            yield* transaction
              .update(Database.Schema.agent_session)
              .set({ sync_seq: input.seq, sync_upload_open: false })
              .where(eq(Database.Schema.agent_session.id, sessionId))
          }),
        )
      }),
      restore: Effect.fn("SessionSync.restore")(function* (host: Host, sessionId: Session.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* lock(transaction, host, sessionId)
            const tree = yield* transaction
              .update(Database.Schema.agent_session)
              .set({ sync_seq: null, sync_upload_open: false })
              .where(inScope(host))
              .returning({ id: Database.Schema.agent_session.id, parentId: Database.Schema.agent_session.parent_id })
            const parents = new Map(tree.map((session) => [session.id, session.parentId]))
            const depth = (id: Session.ID | null): number => (id ? depth(parents.get(id) ?? null) + 1 : 0)
            const rows = yield* OpenCodeStore.sessions(
              transaction,
              tree.map((session) => session.id),
            )
            return rows.toSorted((left, right) => depth(left.id) - depth(right.id))
          }),
        )
      }),
      messages: Effect.fn("SessionSync.messages")(function* (
        host: Host,
        sessionId: Session.ID,
        input: { readonly after?: Cursor | undefined; readonly limit: number },
      ) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const visible = yield* transaction
              .select({ id: Database.Schema.agent_session.id })
              .from(Database.Schema.agent_session)
              .where(and(eq(Database.Schema.agent_session.id, sessionId), inScope(host)))
            if (visible.length === 0) return yield* forbidden
            const messages = yield* OpenCodeStore.messages(transaction, sessionId, input.after, input.limit)
            const last = messages.at(-1)
            return {
              messages,
              next: last && messages.length === input.limit ? { seq: last.seq, id: last.id } : null,
            }
          }),
        )
      }),
    })
  }),
)
