export * as Session from "./session.js"

import { Database } from "@ren/db/database"
import { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import { Space } from "@ren/schema/space"
import { and, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm"
import type { NonEmptyReadonlyArray } from "effect/Array"
import { Array, Context, DateTime, Duration, Effect, Layer, Option, Schema, Semaphore, Struct } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { Brains } from "./brains.js"
import { Models } from "./models.js"
import { Primitive } from "./primitive.js"
import { SessionRunner } from "./session/runner.js"
import { SessionPolicy } from "./session/policy.js"
import { SpaceQueries } from "./space/queries.js"
import { OpenCodeStore } from "./session/opencode-store.js"
import { TranscriptCodec } from "./transcript-codec.js"
import { Billing } from "./billing.js"

export const ID = Session.ID
export type ID = Session.ID

export const MessageID = Session.MessageID
export type MessageID = Session.MessageID

export class Busy extends Schema.TaggedError<Busy>()("Session.Busy", { message: Schema.String }) {}

export class PageTooLarge extends Schema.TaggedError<PageTooLarge>()("Session.PageTooLarge", {
  message: Schema.String,
}) {}

export type Interface = Primitive.Interface<typeof Session.definition> & {
  readonly access: (
    actor: Actor.Info,
    id: Session.ID,
    options?: { readonly unreachable?: boolean },
  ) => Effect.Effect<Session.ClientAccess, Primitive.NotFound>
  readonly messages: (
    actor: Actor.Info,
    id: Session.ID,
    query: { readonly limit?: number | undefined; readonly cursor?: string | undefined },
  ) => Effect.Effect<SessionMessage.Page, Primitive.NotFound | Primitive.Invalid | Busy | PageTooLarge>
  readonly models: (actor: Actor.Info, id: Session.ID) => Effect.Effect<ReadonlyArray<SessionModel.Choice>>
  readonly prepare: (actor: Actor.Info, spaceId: Space.ID) => Effect.Effect<void, Primitive.NotFound>
  readonly retry: (
    actor: Actor.Info,
    id: Session.ID,
    message: Session.FirstMessage | undefined,
  ) => Effect.Effect<void, Primitive.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Session") {}

const notFound = new Primitive.NotFound({ message: "Session not found." })

const spaceNotFound = new Primitive.NotFound({ message: "Space not found." })

const updatedAt = sql<Date>`coalesce(to_timestamp(${Database.Schema.opencode_session.time_updated} / 1000.0), ${Database.Schema.agent_session.created_at})`

const select = (transaction: Database.Transaction, actor: Actor.Info) =>
  transaction
    .select({
      session: Database.Schema.agent_session,
      opencode: OpenCodeStore.summary,
      membershipId: SpaceQueries.membership.id,
    })
    .from(Database.Schema.agent_session)
    .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.agent_session.space_id))
    .leftJoin(Database.Schema.opencode_session, OpenCodeStore.join)
    .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))

type Row = Effect.Success<ReturnType<typeof select>>[number]

const toInfo = (row: Row): Session.Info => ({
  id: row.session.id,
  spaceId: row.session.space_id,
  createdBy: row.session.created_by,
  harness: row.session.harness,
  title: row.opencode?.title ?? null,
  status: row.opencode?.timeSuspended ? "busy" : "idle",
  capabilities: SessionCapabilities.of(row.session.harness),
  createdAt: DateTime.fromDateUnsafe(row.session.created_at),
  updatedAt: row.opencode
    ? DateTime.makeUnsafe(row.opencode.updatedAt)
    : DateTime.fromDateUnsafe(row.session.created_at),
  archivedAt: row.session.archived_at && DateTime.fromDateUnsafe(row.session.archived_at),
  filesResetAt: row.session.files_reset_at && DateTime.fromDateUnsafe(row.session.files_reset_at),
})

const modelNotFound = new Primitive.NotFound({ message: "Model not found." })

// oxlint-disable-next-line ren/no-comments -- Saved history read limits (E111), as ren-v1 INV-63.
const historyReads = 4

const historyWaiting = 16

const historyWaitsFor = Duration.seconds(2)

const historyReadsWithin = Duration.seconds(5)

const historyMemoryBytes = 48 * 1024 * 1024

const historyPageBytes = 16 * 1024 * 1024

const historyPageSize = 50

const dataUrlChars = 1024

const busy = new Busy({ message: "Ren is reading too much saved history. Ask again in 2 seconds." })

const HistoryCursor = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(Schema.Struct({ seq: Schema.Int, id: Schema.String }))),
)

const cut = (url: string) => (url.startsWith("data:") && url.length > dataUrlChars ? url.slice(0, dataUrlChars) : url)

const cutFiles = (content: NonEmptyReadonlyArray<SessionMessage.ToolContent>) =>
  Array.map(content, (item) => (item.type === "file" ? Struct.evolve(item, { uri: cut }) : item))

const cutTool = (part: SessionMessage.Content): SessionMessage.Content => {
  if (part.type !== "tool") return part
  const state = part.state
  if (state.status === "completed")
    return Struct.evolve(part, { state: () => Struct.evolve(state, { content: cutFiles }) })
  if (state.status !== "error" || !state.content) return part
  const content = state.content
  return Struct.evolve(part, { state: () => Struct.evolve(state, { content: () => cutFiles(content) }) })
}

const cutDataUrls = (message: SessionMessage.Info): SessionMessage.Info => {
  if (message.type === "assistant") return Struct.evolve(message, { content: (content) => content.map(cutTool) })
  if (message.type !== "user" || !message.files) return message
  const files = message.files
  return Struct.evolve(message, { files: () => files.map((file) => Struct.evolve(file, { data: cut })) })
}

const actions = SessionPolicy.actions

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const memberOf = (actor: Actor.Info) =>
      Actor.memberOf(database.db, actor).pipe(Effect.catchTag("Primitive.Forbidden", () => Effect.fail(notFound)))
    const access = yield* Access.Service
    const sessions = yield* SessionRunner.Service
    const brain = yield* Brains.Service
    const catalog = yield* Models.Service
    const codecs = yield* TranscriptCodec.Registry
    const historyAdmitted = yield* Semaphore.make(historyReads + historyWaiting)
    const historyReading = yield* Semaphore.make(historyReads)
    const historyMemory = yield* Semaphore.make(historyMemoryBytes)

    const models = (actor: Actor.Info) =>
      catalog.catalog(actor.organizationId).pipe(
        Effect.orDie,
        Effect.map((found) =>
          found.endpoints.flatMap((endpoint) =>
            endpoint.models.map((model): SessionModel.Choice => ({
              id: model.id,
              providerID: endpoint.id,
              name: model.name ?? model.id,
              variants: (model.efforts ?? []).map((effort) => ({ id: effort })),
            })),
          ),
        ),
      )

    const visibleTo = (actor: Actor.Info, action: string) =>
      and(
        eq(Database.Schema.space.organization_id, actor.organizationId),
        isNull(Database.Schema.space.archived_at),
        isNull(Database.Schema.agent_session.parent_id),
        Access.where(access.plan(actor, action), SpaceQueries.where),
      )

    const find = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      where: SQL | undefined,
      action: string = actions.get,
    ) {
      const row = (yield* select(transaction, actor).where(and(visibleTo(actor, action), where))).at(0)
      if (!row) return yield* notFound
      return row
    })

    const visibleSpace = Effect.fnUntraced(function* (actor: Actor.Info, spaceId: Space.ID) {
      const space = yield* database.transaction((transaction) =>
        transaction
          .select({ id: Database.Schema.space.id, membershipId: SpaceQueries.membership.id })
          .from(Database.Schema.space)
          .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
          .where(
            and(
              eq(Database.Schema.space.id, spaceId),
              eq(Database.Schema.space.organization_id, actor.organizationId),
              isNull(Database.Schema.space.archived_at),
            ),
          ),
      )
      const found = space.at(0)
      if (
        !found ||
        !access.isAllowed({ actor, action: actions.create, resource: SessionPolicy.resource(found.membershipId) })
      )
        return yield* spaceNotFound
    })

    const read = (actor: Actor.Info, id: Session.ID, action: string = actions.get) =>
      database.transaction((transaction) => find(transaction, actor, eq(Database.Schema.agent_session.id, id), action))

    const history = Effect.fnUntraced(function* (
      actor: Actor.Info,
      id: Session.ID,
      query: { readonly limit?: number | undefined; readonly cursor?: string | undefined },
    ) {
      const row = yield* read(actor, id)
      const before = query.cursor
        ? yield* Schema.decodeUnknownEffect(HistoryCursor)(query.cursor).pipe(
            Effect.mapError(() => new Primitive.Invalid({ message: "The cursor is not valid.", field: "cursor" })),
          )
        : undefined
      const limit = query.limit ?? historyPageSize
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* OpenCodeStore.history(transaction, id, {
              before,
              revertMessageId: row.session.revert_message_id,
              limit: limit + 1,
            })
            const page = found.slice(0, limit)
            const bytes = page.reduce((sum, each) => sum + each.bytes, 0)
            if (bytes > historyPageBytes)
              return yield* new PageTooLarge({
                message: `This page of saved history is ${bytes} bytes, over the ${historyPageBytes} byte limit. Ask for fewer messages.`,
              })
            const items = yield* OpenCodeStore.messagesOf(
              transaction,
              id,
              page.map((each) => each.id),
            ).pipe(
              Effect.flatMap((rows) => codecs.get(row.session.harness).messages(rows, row.session.harness_version)),
              historyMemory.withPermitsIfAvailable(bytes),
            )
            if (Option.isNone(items)) return yield* busy
            const last = page.at(-1)
            return {
              items: items.value.map(cutDataUrls),
              cursor: found.length > limit && last ? { next: Schema.encodeSync(HistoryCursor)(last) } : {},
            }
          }),
        )
        .pipe(Effect.timeoutOrElse({ duration: historyReadsWithin, orElse: () => Effect.fail(busy) }))
    })

    return Service.of({
      list: Effect.fn("Session.list")(function* (actor: Actor.Info, input: Session.ListInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const where = and(
              visibleTo(actor, actions.list),
              input.spaceId
                ? eq(Database.Schema.agent_session.space_id, input.spaceId)
                : eq(Database.Schema.agent_session.created_by, actor.userId),
              isNull(Database.Schema.agent_session.archived_at),
            )
            const rows = yield* select(transaction, actor)
              .where(where)
              .orderBy(desc(updatedAt), desc(Database.Schema.agent_session.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(Database.Schema.agent_session)
              .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.agent_session.space_id))
              .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
              .where(where)
            return {
              items: rows.map(toInfo),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      get: Effect.fn("Session.get")(function* (actor: Actor.Info, idOrSlug: string) {
        if (!Schema.is(Session.ID)(idOrSlug)) return yield* notFound
        return toInfo(yield* read(actor, idOrSlug))
      }),
      create: Effect.fn("Session.create")(function* (actor: Actor.Info, input: Session.CreateInput) {
        yield* visibleSpace(actor, input.spaceId)
        const model = input.model
        if (
          model &&
          !(yield* models(actor)).some(
            (item) =>
              item.id === model.id &&
              item.providerID === model.providerID &&
              (!model.variant || item.variants.some((variant) => variant.id === model.variant)),
          )
        )
          return yield* modelNotFound
        const start: Session.StartInput = {
          sessionId: input.id,
          harness: "opencode",
          interactive: true,
          ...(model && {
            model: {
              endpointId: model.providerID,
              modelId: model.id,
              ...(model.variant && { variant: model.variant }),
            },
          }),
          ...(input.message && {
            initialMessage: {
              messageId: Session.MessageID.make(input.message.id),
              prompt: { text: input.message.text },
              sender: { userId: actor.userId, memberId: yield* memberOf(actor) },
            },
          }),
        }
        yield* sessions
          .create({ organizationId: actor.organizationId, spaceId: input.spaceId, createdBy: actor.userId }, start)
          .pipe(
            Effect.catchTag("SessionRunner.AlreadyExists", () =>
              Effect.gen(function* () {
                const existing = yield* sessions.get(input.id).pipe(Effect.orDie)
                if (existing.createdBy !== actor.userId || existing.spaceId !== input.spaceId)
                  return yield* new Primitive.Conflict({ message: "A session with this ID already exists." })
                return yield* brain.start(start, {
                  organizationId: actor.organizationId,
                  spaceId: input.spaceId,
                  brainId: existing.brainId,
                })
              }),
            ),
            Effect.catchTags({
              BrainRejectedError: Effect.die,
              "SessionRunner.NotFound": Effect.die,
              "Billing.Refused": (refused) =>
                Effect.fail(new Primitive.Forbidden({ message: Billing.messages[refused.reason] })),
            }),
          )
        return toInfo(yield* read(actor, input.id))
      }),
      archive: Effect.fn("Session.archive")(function* (actor: Actor.Info, id: Session.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, eq(Database.Schema.agent_session.id, id))
            if (
              !access.isAllowed({ actor, action: actions.archive, resource: SessionPolicy.resource(row.membershipId) })
            )
              return yield* new Primitive.Forbidden({ message: "You cannot archive this chat." })
            if (row.session.archived_at) return toInfo(row)
            yield* transaction
              .update(Database.Schema.agent_session)
              .set({ archived_at: new Date() })
              .where(eq(Database.Schema.agent_session.id, id))
            return toInfo(yield* find(transaction, actor, eq(Database.Schema.agent_session.id, id)))
          }),
        )
      }),
      messages: Effect.fn("Session.messages")(function* (actor, id, query) {
        const admitted = yield* Effect.uninterruptibleMask((restore) =>
          restore(
            historyReading
              .take(1)
              .pipe(Effect.timeoutOrElse({ duration: historyWaitsFor, orElse: () => Effect.fail(busy) })),
          ).pipe(Effect.andThen(restore(history(actor, id, query)).pipe(Effect.ensuring(historyReading.release(1))))),
        ).pipe(historyAdmitted.withPermitsIfAvailable(1))
        if (Option.isNone(admitted)) return yield* busy
        return admitted.value
      }),
      models: Effect.fn("Session.models")(models),
      prepare: Effect.fn("Session.prepare")(function* (actor: Actor.Info, spaceId: Space.ID) {
        yield* visibleSpace(actor, spaceId)
        yield* brain.prepare(spaceId)
      }),
      retry: Effect.fn("Session.retry")(function* (
        actor: Actor.Info,
        id: Session.ID,
        message: Session.FirstMessage | undefined,
      ) {
        const row = yield* read(actor, id, actions.retry)
        yield* brain.retry(id)
        if (!message || row.opencode) return
        const start = yield* Schema.decodeUnknownEffect(Session.StartInput)(
          row.session.start_input ?? { sessionId: id, harness: row.session.harness },
        ).pipe(Effect.orDie)
        yield* brain
          .start(
            {
              ...start,
              initialMessage: {
                messageId: Session.MessageID.make(message.id),
                prompt: { text: message.text },
                sender: { userId: actor.userId, memberId: yield* memberOf(actor) },
              },
            },
            { organizationId: actor.organizationId, spaceId: row.session.space_id, brainId: row.session.brain_id },
          )
          .pipe(Effect.catchTag("BrainRejectedError", Effect.die))
      }),
      access: Effect.fn("Session.access")(function* (
        actor: Actor.Info,
        id: Session.ID,
        options: { readonly unreachable?: boolean } = {},
      ) {
        yield* read(actor, id, actions.access)
        const user = (yield* database.transaction((transaction) =>
          transaction
            .select({ name: Database.Schema.user.name, email: Database.Schema.user.email })
            .from(Database.Schema.user)
            .where(eq(Database.Schema.user.id, actor.userId)),
        )).at(0)
        return yield* brain.access(
          id,
          {
            userId: actor.userId,
            memberId: yield* memberOf(actor),
            ...(user && { name: user.name.trim() ? `${user.name.trim()} (${user.email})` : user.email }),
          },
          options,
        )
      }),
    })
  }),
)
