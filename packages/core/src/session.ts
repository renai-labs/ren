export * as Session from "./session.js"

import { Database } from "@ren/db/database"
import { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import type { SessionModel } from "@ren/schema/session/model"
import { Space } from "@ren/schema/space"
import { and, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { BrainHost } from "./brain-host.js"
import { Models } from "./models.js"
import { Primitive } from "./primitive.js"
import { SessionRunner } from "./session/runner.js"
import { SpacePolicy } from "./space/policy.js"
import { SpaceQueries } from "./space/queries.js"
import { OpenCodeStore } from "./session/opencode-store.js"

export const ID = Session.ID
export type ID = Session.ID

export const MessageID = Session.MessageID
export type MessageID = Session.MessageID

export type Interface = Primitive.Interface<typeof Session.definition> & {
  readonly access: (actor: Actor.Info, id: Session.ID) => Effect.Effect<Session.ClientAccess, Primitive.NotFound>
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
})

const modelNotFound = new Primitive.NotFound({ message: "Model not found." })

const spaceGet = Primitive.action(Space.definition, "get")
const spaceUpdate = Primitive.action(Space.definition, "update")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const sessions = yield* SessionRunner.Service
    const brain = yield* BrainHost.Service
    const catalog = yield* Models.Service

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

    const visibleTo = (actor: Actor.Info) =>
      and(
        eq(Database.Schema.space.organization_id, actor.organizationId),
        isNull(Database.Schema.space.archived_at),
        isNull(Database.Schema.agent_session.parent_id),
        SpacePolicy.filter(access.plan(actor, spaceGet)),
      )

    const find = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      where: SQL | undefined,
    ) {
      const row = (yield* select(transaction, actor).where(and(visibleTo(actor), where))).at(0)
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
              SpacePolicy.filter(access.plan(actor, spaceGet)),
            ),
          ),
      )
      if (space.length === 0) return yield* spaceNotFound
    })

    const read = (actor: Actor.Info, id: Session.ID) =>
      database.transaction((transaction) => find(transaction, actor, eq(Database.Schema.agent_session.id, id)))

    return Service.of({
      list: Effect.fn("Session.list")(function* (actor: Actor.Info, input: Session.ListInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const where = and(
              visibleTo(actor),
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
              sender: { userId: actor.userId },
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
            }),
          )
        return toInfo(yield* read(actor, input.id))
      }),
      archive: Effect.fn("Session.archive")(function* (actor: Actor.Info, id: Session.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, eq(Database.Schema.agent_session.id, id))
            const isAdmin = access.plan(actor, spaceUpdate).isAllowedEverywhere
            if (row.session.created_by !== actor.userId && !isAdmin)
              return yield* new Primitive.Forbidden({ message: "Only the person who started a chat can archive it." })
            if (row.session.archived_at) return toInfo(row)
            yield* transaction
              .update(Database.Schema.agent_session)
              .set({ archived_at: new Date() })
              .where(eq(Database.Schema.agent_session.id, id))
            return toInfo(yield* find(transaction, actor, eq(Database.Schema.agent_session.id, id)))
          }),
        )
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
        const row = yield* read(actor, id)
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
                sender: { userId: actor.userId },
              },
            },
            { organizationId: actor.organizationId, spaceId: row.session.space_id, brainId: row.session.brain_id },
          )
          .pipe(Effect.catchTag("BrainRejectedError", Effect.die))
      }),
      access: Effect.fn("Session.access")(function* (actor: Actor.Info, id: Session.ID) {
        yield* read(actor, id)
        const user = (yield* database.transaction((transaction) =>
          transaction
            .select({ name: Database.Schema.user.name, email: Database.Schema.user.email })
            .from(Database.Schema.user)
            .where(eq(Database.Schema.user.id, actor.userId)),
        )).at(0)
        return yield* brain.access(id, {
          userId: actor.userId,
          ...(user && { name: user.name.trim() ? `${user.name.trim()} (${user.email})` : user.email }),
        })
      }),
    })
  }),
)
