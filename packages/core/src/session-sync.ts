export * as SessionSync from "./session-sync.js"

import { ForbiddenError, StaleUploadError } from "@ren/host-api/errors"
import type { CurrentHost } from "@ren/host-api/ren-host-api"
import type { Sync } from "@ren/schema/sync"
import { Database } from "@ren/db/database"
import { Session } from "@ren/schema/session"
import { and, asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { OpenCodeStore } from "./session/opencode-store.js"

export { ForbiddenError, StaleUploadError } from "@ren/host-api/errors"

export type Host = CurrentHost["Service"]

export type Cursor = OpenCodeStore.Cursor

export interface Checkpoint {
  readonly id: Session.ID
  readonly syncSeq: number | null
  readonly timeSuspended: number | null
}

export interface Page {
  readonly messages: ReadonlyArray<Sync.OpenCodeMessageRow>
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
    messages: ReadonlyArray<Sync.OpenCodeMessageRow>,
  ) => Effect.Effect<void, ForbiddenError | StaleUploadError>
  readonly commit: (
    host: Host,
    sessionId: Session.ID,
    upload: number,
    input: { readonly session: Sync.OpenCodeSessionRow; readonly seq: number; readonly ids: ReadonlyArray<string> },
  ) => Effect.Effect<void, ForbiddenError | StaleUploadError>
  readonly restore: (
    host: Host,
    sessionId: Session.ID,
    directoryOf?: (chat: Session.ID) => Effect.Effect<Option.Option<string>, ForbiddenError>,
  ) => Effect.Effect<ReadonlyArray<Sync.RestoredChat>, ForbiddenError>
  readonly messages: (
    host: Host,
    sessionId: Session.ID,
    input: { readonly after?: Cursor | undefined; readonly limit: number },
  ) => Effect.Effect<Page, ForbiddenError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SessionSync") {}

const forbidden = new ForbiddenError({ message: "The session is not on the brain of the host token" })

const stale = new StaleUploadError({ message: "The upload is not the current open upload of the session" })

const inScope = (host: Host) =>
  and(
    eq(Database.Schema.agent_session.brain_id, host.brainId),
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
                  brain_id: parent.brain_id,
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
        messages: ReadonlyArray<Sync.OpenCodeMessageRow>,
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
        input: { readonly session: Sync.OpenCodeSessionRow; readonly seq: number; readonly ids: ReadonlyArray<string> },
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
      restore: Effect.fn("SessionSync.restore")(function* (
        host: Host,
        sessionId: Session.ID,
        directoryOf: (chat: Session.ID) => Effect.Effect<Option.Option<string>, ForbiddenError> = () =>
          Effect.succeedNone,
      ) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const chat = yield* lock(transaction, host, sessionId)
            const tree = yield* transaction
              .update(Database.Schema.agent_session)
              .set({ sync_seq: null, sync_upload_open: false })
              .where(and(eq(Database.Schema.agent_session.root_id, chat.root_id), inScope(host)))
              .returning({
                id: Database.Schema.agent_session.id,
                parentId: Database.Schema.agent_session.parent_id,
                harness: Database.Schema.agent_session.harness,
                harnessVersion: Database.Schema.agent_session.harness_version,
                revertMessageId: Database.Schema.agent_session.revert_message_id,
                startInput: Database.Schema.agent_session.start_input,
                createdAt: Database.Schema.agent_session.created_at,
              })
            const parents = new Map(tree.map((chat) => [chat.id, chat.parentId]))
            const depth = (id: Session.ID | null): number => (id ? depth(parents.get(id) ?? null) + 1 : 0)
            const rows = new Map(
              (yield* OpenCodeStore.sessions(
                transaction,
                tree.map((chat) => chat.id),
              )).map((row) => [row.id, row]),
            )
            return yield* Effect.forEach(
              tree.toSorted(
                (left, right) =>
                  depth(left.id) - depth(right.id) ||
                  left.createdAt.getTime() - right.createdAt.getTime() ||
                  (left.id < right.id ? -1 : 1),
              ),
              (chat) =>
                Effect.gen(function* () {
                  const session = rows.get(chat.id) ?? null
                  const restored = {
                    id: chat.id,
                    harness: chat.harness,
                    harnessVersion: chat.harnessVersion,
                    parentId: chat.parentId,
                    revertMessageId: chat.revertMessageId,
                    session,
                  }
                  if (session || !chat.startInput) return restored satisfies Sync.RestoredChat
                  const start = yield* Schema.decodeUnknownEffect(Session.StartInput)(chat.startInput).pipe(
                    Effect.orDie,
                  )
                  return Option.match(yield* directoryOf(chat.id), {
                    onNone: () => ({ ...restored, start }) satisfies Sync.RestoredChat,
                    onSome: (directory) => ({ ...restored, start, directory }) satisfies Sync.RestoredChat,
                  })
                }),
            )
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
