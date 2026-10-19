export * as SpaceEnvironment from "./environment.js"

import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { SpaceEnvironment } from "@ren/schema/space-environment"
import { and, asc, count, eq, isNull, sql } from "drizzle-orm"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Cause, Context, DateTime, Effect, Layer, Option } from "effect"
import { SqlError } from "effect/sql"
import { Access } from "../access.js"
import { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { SpacePolicy } from "./policy.js"
import { SpaceQueries } from "./queries.js"

export type Interface = Primitive.Interface<typeof SpaceEnvironment.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceEnvironment") {}

const notFound = new Primitive.NotFound({ message: "Space environment not found." })

const forbidden = new Primitive.Forbidden({ message: "You cannot manage the environments of this space." })

const table = Database.Schema.space_environment

const actions = {
  getSpace: Primitive.action(Space.definition, "get"),
  list: Primitive.action(SpaceEnvironment.definition, "list"),
  create: Primitive.action(SpaceEnvironment.definition, "create"),
  archive: Primitive.action(SpaceEnvironment.definition, "archive"),
}

const toInfo = (row: typeof table.$inferSelect): SpaceEnvironment.Info => ({
  id: row.id,
  spaceId: row.space_id,
  environmentId: row.environment_id,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

const isLinkedAlready = (error: EffectDrizzleQueryError) => {
  const failure = Cause.isCause(error.cause) ? Cause.findErrorOption(error.cause) : Option.none()
  return (
    Option.isSome(failure) &&
    SqlError.isSqlError(failure.value) &&
    failure.value.reason._tag === "UniqueViolation" &&
    failure.value.reason.constraint === Database.Schema.spaceEnvironmentConstraint
  )
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const lockSpace = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      spaceId: Space.ID,
    ) {
      const rows = yield* transaction
        .select({ membershipId: SpaceQueries.membership.id })
        .from(Database.Schema.space)
        .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
        .where(
          and(
            eq(Database.Schema.space.id, spaceId),
            eq(Database.Schema.space.organization_id, actor.organizationId),
            isNull(Database.Schema.space.archived_at),
          ),
        )
        .for("share", { of: Database.Schema.space })
      const row = rows.at(0)
      if (!row) return
      const resource = SpacePolicy.resource(row.membershipId)
      if (!access.isAllowed({ actor, action: actions.getSpace, resource })) return
      return resource
    })

    return Service.of({
      list: Effect.fn("SpaceEnvironment.list")(function* (actor: Actor.Info, input: SpaceEnvironment.ListInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const space = yield* lockSpace(transaction, actor, input.spaceId)
            if (!space || !access.isAllowed({ actor, action: actions.list, resource: space }))
              return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
            const where = and(eq(table.space_id, input.spaceId), isNull(table.archived_at))
            const rows = yield* transaction
              .select()
              .from(table)
              .where(where)
              .orderBy(asc(table.created_at), asc(table.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction.select({ total: count() }).from(table).where(where)
            return {
              items: rows.map(toInfo),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      create: Effect.fn("SpaceEnvironment.create")(function* (actor: Actor.Info, input: SpaceEnvironment.CreateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const space = yield* lockSpace(transaction, actor, input.spaceId)
            if (!space) return yield* new Primitive.NotFound({ message: "Space not found." })
            if (!access.isAllowed({ actor, action: actions.create, resource: space })) return yield* forbidden
            const environments = yield* transaction
              .select({ id: Database.Schema.environment.id })
              .from(Database.Schema.environment)
              .where(
                and(
                  eq(Database.Schema.environment.id, input.environmentId),
                  eq(Database.Schema.environment.organization_id, actor.organizationId),
                  isNull(Database.Schema.environment.archived_at),
                ),
              )
              .for("share")
            if (environments.length === 0) return yield* new Primitive.NotFound({ message: "Environment not found." })
            const rows = yield* transaction
              .insert(table)
              .values({
                id: SpaceEnvironment.ID.create(),
                space_id: input.spaceId,
                environment_id: input.environmentId,
              })
              .returning()
              .pipe(
                Effect.catchIf(isLinkedAlready, () =>
                  Effect.fail(new Primitive.Conflict({ message: "The space already has this environment." })),
                ),
              )
            const row = rows.at(0)
            if (!row) return yield* notFound
            return toInfo(row)
          }),
        )
      }),
      archive: Effect.fn("SpaceEnvironment.archive")(function* (actor: Actor.Info, id: SpaceEnvironment.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = (yield* transaction.select().from(table).where(eq(table.id, id))).at(0)
            if (!found) return yield* notFound
            const space = yield* lockSpace(transaction, actor, found.space_id)
            if (!space) return yield* notFound
            if (found.archived_at) return toInfo(found)
            if (!access.isAllowed({ actor, action: actions.archive, resource: space })) return yield* forbidden
            const rows = yield* transaction
              .update(table)
              .set({ archived_at: sql`now()` })
              .where(and(eq(table.id, id), isNull(table.archived_at)))
              .returning()
            const row = rows.at(0)
            if (!row) return yield* notFound
            return toInfo(row)
          }),
        )
      }),
    })
  }),
)
