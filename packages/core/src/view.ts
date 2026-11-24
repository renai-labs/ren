export * as View from "./view.js"

import { Database } from "@ren/db/database"
import { View } from "@ren/schema/view"
import { and, asc, count, eq, isNotNull, isNull, type SQL, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Record } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
import { SpaceQueries } from "./space/queries.js"
import { ViewPolicy } from "./view/policy.js"

export type Interface = Primitive.Interface<typeof View.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/View") {}

const notFound = new Primitive.NotFound({ message: "View not found." })

const forbidden = new Primitive.Forbidden({ message: "You cannot change this view." })

const epoch = DateTime.makeUnsafe(0)

export const systemOf = Record.map(View.system, (views, type) =>
  views.map((each): View.Info => ({
    id: each.id,
    type,
    name: each.name,
    filters: each.filters,
    organizationId: null,
    ownerId: null,
    spaceId: null,
    shared: true,
    isSystem: true,
    display: null,
    createdAt: epoch,
    updatedAt: epoch,
    archivedAt: null,
  })),
)

export const system = Object.values(systemOf).flat()

type Row = typeof Database.Schema.view.$inferSelect

const toInfo = (row: Row): View.Info => ({
  id: row.id,
  organizationId: row.organization_id,
  ownerId: row.owner_id,
  spaceId: row.space_id,
  type: row.type,
  name: row.name,
  shared: row.shared,
  isSystem: false,
  filters: row.filters,
  display: row.display,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  updatedAt: DateTime.fromDateUnsafe(row.updated_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

const view = Database.Schema.view

const memberOf = (actor: Actor.Info) =>
  sql<boolean>`exists (select 1 from ${Database.Schema.space_member} where ${Database.Schema.space_member.space_id} = ${view.space_id} and ${Database.Schema.space_member.user_id} = ${actor.userId} and ${Database.Schema.space_member.archived_at} is null and ${Actor.fenced(actor, Database.Schema.space_member.space_id) ?? sql`true`})`

const facts = (actor: Actor.Info): ReadonlyMap<string, SQL> =>
  new Map([
    [ViewPolicy.facts.owner, eq(view.owner_id, actor.userId)],
    [ViewPolicy.facts.shared, eq(view.shared, true)],
    [ViewPolicy.facts.organization, isNull(view.space_id)],
    [ViewPolicy.facts.space, isNotNull(view.space_id)],
    [ViewPolicy.facts.member, memberOf(actor)],
  ])

const written = (rows: ReadonlyArray<Row>) => {
  const row = rows.at(0)
  return row ? Effect.succeed(toInfo(row)) : Effect.fail(notFound)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const visibleTo = (actor: Actor.Info) =>
      and(
        eq(view.organization_id, actor.organizationId),
        isNull(view.archived_at),
        Access.where(access.plan(actor, ViewPolicy.actions.list), facts(actor)),
      )

    const lock = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: View.ID,
      action: string,
    ) {
      if (system.some((each) => each.id === id))
        return yield* new Primitive.Forbidden({ message: "System views can’t be changed." })
      const row = (yield* transaction
        .select({ view, isMember: memberOf(actor) })
        .from(view)
        .where(and(eq(view.id, id), visibleTo(actor)))
        .for("update", { of: view })).at(0)
      if (!row) return yield* notFound
      const resource = ViewPolicy.resource({
        isOwner: row.view.owner_id === actor.userId,
        shared: row.view.shared,
        spaceId: row.view.space_id,
        isMember: row.isMember,
      })
      if (!access.isAllowed({ actor, action, resource })) return yield* forbidden
    })

    return Service.of({
      list: Effect.fn("View.list")(function* (actor: Actor.Info, input: View.ListInput) {
        const fixed = input.type ? systemOf[input.type] : system
        const start = (input.page - 1) * input.pageSize
        const first = fixed.slice(start, start + input.pageSize)
        const where = and(
          visibleTo(actor),
          input.type ? eq(view.type, input.type) : undefined,
          input.spaceId ? eq(view.space_id, input.spaceId) : isNull(view.space_id),
        )
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* transaction
              .select()
              .from(view)
              .where(where)
              .orderBy(asc(view.created_at), asc(view.id))
              .limit(input.pageSize - first.length)
              .offset(Math.max(0, start - fixed.length))
            const totals = yield* transaction.select({ total: count() }).from(view).where(where)
            return {
              items: [...first, ...rows.map(toInfo)],
              page: input.page,
              pageSize: input.pageSize,
              total: fixed.length + (totals.at(0)?.total ?? 0),
            }
          }),
        )
      }),
      create: Effect.fn("View.create")(function* (actor: Actor.Info, input: View.CreateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const spaceId = input.spaceId
            const isMember = spaceId
              ? Boolean(
                  (yield* transaction
                    .select({ id: Database.Schema.space.id })
                    .from(Database.Schema.space)
                    .innerJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
                    .where(
                      and(
                        eq(Database.Schema.space.id, spaceId),
                        eq(Database.Schema.space.organization_id, actor.organizationId),
                        isNull(Database.Schema.space.archived_at),
                      ),
                    )).at(0),
                )
              : false
            const shared = input.shared ?? false
            const resource = ViewPolicy.resource({ isOwner: true, shared, spaceId: spaceId ?? null, isMember })
            if (!access.isAllowed({ actor, action: ViewPolicy.actions.create, resource })) return yield* forbidden
            const rows = yield* transaction
              .insert(view)
              .values({
                id: View.ID.create(),
                organization_id: actor.organizationId,
                owner_id: actor.userId,
                space_id: spaceId ?? null,
                type: input.type,
                name: input.name,
                shared,
                filters: input.filters,
                display: input.display ?? null,
              })
              .returning()
            return yield* written(rows)
          }),
        )
      }),
      update: Effect.fn("View.update")(function* (actor: Actor.Info, id: View.ID, input: View.UpdateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* lock(transaction, actor, id, ViewPolicy.actions.update)
            const rows = yield* transaction
              .update(view)
              .set({
                name: input.name,
                shared: input.shared,
                filters: input.filters,
                display: input.display,
                updated_at: sql`now()`,
              })
              .where(eq(view.id, id))
              .returning()
            return yield* written(rows)
          }),
        )
      }),
      archive: Effect.fn("View.archive")(function* (actor: Actor.Info, id: View.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* lock(transaction, actor, id, ViewPolicy.actions.archive)
            const rows = yield* transaction
              .update(view)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(view.id, id))
              .returning()
            return yield* written(rows)
          }),
        )
      }),
    })
  }),
)
