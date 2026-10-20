export * as SpaceEnvironmentTemplate from "./environment-template.js"

import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { SpaceEnvironmentTemplate } from "@ren/schema/space-environment-template"
import { and, asc, count, eq, isNull, sql } from "drizzle-orm"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Cause, Context, DateTime, Effect, Layer, Option } from "effect"
import { SqlError } from "effect/sql"
import { Access } from "../access.js"
import { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { SpacePolicy } from "./policy.js"
import { SpaceQueries } from "./queries.js"

export type Interface = Primitive.Interface<typeof SpaceEnvironmentTemplate.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceEnvironmentTemplate") {}

const notFound = new Primitive.NotFound({ message: "Space environment template not found." })

const forbidden = new Primitive.Forbidden({ message: "You cannot manage the environment templates of this space." })

const table = Database.Schema.space_environment_template

const actions = {
  getSpace: Primitive.action(Space.definition, "get"),
  list: Primitive.action(SpaceEnvironmentTemplate.definition, "list"),
  create: Primitive.action(SpaceEnvironmentTemplate.definition, "create"),
  archive: Primitive.action(SpaceEnvironmentTemplate.definition, "archive"),
}

const toInfo = (row: typeof table.$inferSelect): SpaceEnvironmentTemplate.Info => ({
  id: row.id,
  spaceId: row.space_id,
  environmentTemplateId: row.environment_template_id,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

const isAlreadyInSpace = (error: EffectDrizzleQueryError) => {
  const failure = Cause.isCause(error.cause) ? Cause.findErrorOption(error.cause) : Option.none()
  return (
    Option.isSome(failure) &&
    SqlError.isSqlError(failure.value) &&
    failure.value.reason._tag === "UniqueViolation" &&
    failure.value.reason.constraint === Database.Schema.spaceEnvironmentTemplateConstraint
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
      list: Effect.fn("SpaceEnvironmentTemplate.list")(function* (
        actor: Actor.Info,
        input: SpaceEnvironmentTemplate.ListInput,
      ) {
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
      create: Effect.fn("SpaceEnvironmentTemplate.create")(function* (
        actor: Actor.Info,
        input: SpaceEnvironmentTemplate.CreateInput,
      ) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const space = yield* lockSpace(transaction, actor, input.spaceId)
            if (!space) return yield* new Primitive.NotFound({ message: "Space not found." })
            if (!access.isAllowed({ actor, action: actions.create, resource: space })) return yield* forbidden
            const templates = yield* transaction
              .select({ id: Database.Schema.environment_template.id })
              .from(Database.Schema.environment_template)
              .where(
                and(
                  eq(Database.Schema.environment_template.id, input.environmentTemplateId),
                  eq(Database.Schema.environment_template.organization_id, actor.organizationId),
                  isNull(Database.Schema.environment_template.archived_at),
                ),
              )
              .for("share")
            if (templates.length === 0)
              return yield* new Primitive.NotFound({ message: "Environment template not found." })
            const rows = yield* transaction
              .insert(table)
              .values({
                id: SpaceEnvironmentTemplate.ID.create(),
                space_id: input.spaceId,
                environment_template_id: input.environmentTemplateId,
              })
              .returning()
              .pipe(
                Effect.catchIf(isAlreadyInSpace, () =>
                  Effect.fail(new Primitive.Conflict({ message: "The space already has this environment template." })),
                ),
              )
            const row = rows.at(0)
            if (!row) return yield* notFound
            return toInfo(row)
          }),
        )
      }),
      archive: Effect.fn("SpaceEnvironmentTemplate.archive")(function* (
        actor: Actor.Info,
        id: SpaceEnvironmentTemplate.ID,
      ) {
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
