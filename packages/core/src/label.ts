export * as Label from "./label.js"

import { Database } from "@ren/db/database"
import { Label } from "@ren/schema/label"
import type { Space } from "@ren/schema/space"
import { and, asc, count, eq, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Context, DateTime, Effect, Layer } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
import { SpaceQueries } from "./space/queries.js"
import { TaskPolicy } from "./task/policy.js"

export type Interface = Primitive.Interface<typeof Label.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/Label") {}

const notFound = new Primitive.NotFound({ message: "Label not found." })

const actions = {
  list: Primitive.action(Label.definition, "list"),
  create: Primitive.action(Label.definition, "create"),
  update: Primitive.action(Label.definition, "update"),
  archive: Primitive.action(Label.definition, "archive"),
}

type Row = typeof Database.Schema.label.$inferSelect

const toInfo = (row: Row): Label.Info => ({
  id: row.id,
  organizationId: row.organization_id,
  spaceId: row.space_id,
  name: row.name,
  color: row.color,
  isSystem: !row.organization_id,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  updatedAt: DateTime.fromDateUnsafe(row.updated_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

const label = Database.Schema.label

const memberOf = (actor: Actor.Info) =>
  sql<boolean>`exists (select 1 from ${Database.Schema.space_member} where ${Database.Schema.space_member.space_id} = ${label.space_id} and ${Database.Schema.space_member.user_id} = ${actor.userId} and ${Database.Schema.space_member.archived_at} is null and ${Actor.fenced(actor, Database.Schema.space_member.space_id) ?? sql`true`})`

// oxlint-disable-next-line ren/no-comments -- The SQL of each label fact.
const facts = (actor: Actor.Info): ReadonlyMap<string, SQL> =>
  new Map([
    [TaskPolicy.facts.systemLabel, isNull(label.organization_id)],
    [
      TaskPolicy.facts.orgLabel,
      and(eq(label.organization_id, actor.organizationId), isNull(label.space_id)) ?? sql`false`,
    ],
    [
      TaskPolicy.facts.spaceLabel,
      and(eq(label.organization_id, actor.organizationId), isNotNull(label.space_id)) ?? sql`false`,
    ],
    [TaskPolicy.facts.spaceMember, memberOf(actor)],
  ])

const nameTaken = (name: string) => (error: EffectDrizzleQueryError) =>
  Primitive.uniqueConflict(
    Database.Schema.labelNameConstraint,
    `A label named ${name} already exists.`,
  )(error).pipe(
    Effect.catchTag(
      "EffectDrizzleQueryError",
      Primitive.uniqueConflict(Database.Schema.spaceLabelNameConstraint, `A label named ${name} already exists.`),
    ),
  )

const written = (rows: ReadonlyArray<Row>) => {
  const row = rows.at(0)
  return row ? Effect.succeed(toInfo(row)) : Effect.fail(notFound)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const visibleTo = (actor: Actor.Info, spaceId: Space.ID | undefined) =>
      and(
        or(eq(label.organization_id, actor.organizationId), isNull(label.organization_id)),
        isNull(label.archived_at),
        spaceId ? or(isNull(label.space_id), eq(label.space_id, spaceId)) : undefined,
        Access.where(access.plan(actor, actions.list), facts(actor)),
      )

    const forbidden = new Primitive.Forbidden({ message: "You cannot change this label." })

    const findOwn = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: Label.ID,
      action: string,
    ) {
      const row = (yield* transaction
        .select({ label, isMember: memberOf(actor) })
        .from(label)
        .where(and(eq(label.id, id), visibleTo(actor, undefined)))
        .for("update", { of: label })).at(0)
      if (!row) return yield* notFound
      const resource = TaskPolicy.label({
        organizationId: row.label.organization_id,
        spaceId: row.label.space_id,
        isMember: row.isMember,
      })
      if (!access.isAllowed({ actor, action, resource })) return yield* forbidden
      return row.label
    })

    return Service.of({
      list: Effect.fn("Label.list")(function* (actor: Actor.Info, input: Label.ListInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* transaction
              .select()
              .from(label)
              .where(visibleTo(actor, input.spaceId))
              .orderBy(
                sql`${label.organization_id} is not null`,
                sql`${label.space_id} is not null`,
                sql`lower(${label.name})`,
                asc(label.id),
              )
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(label)
              .where(visibleTo(actor, input.spaceId))
            return {
              items: rows.map(toInfo),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      create: Effect.fn("Label.create")(function* (actor: Actor.Info, input: Label.CreateInput) {
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
            const resource = TaskPolicy.label({
              organizationId: actor.organizationId,
              spaceId: spaceId ?? null,
              isMember,
            })
            if (!access.isAllowed({ actor, action: actions.create, resource })) return yield* forbidden
            return yield* transaction
              .insert(label)
              .values({
                id: Label.ID.create(),
                organization_id: actor.organizationId,
                space_id: spaceId ?? null,
                name: input.name,
                color: input.color ?? null,
              })
              .returning()
              .pipe(Effect.catchTag("EffectDrizzleQueryError", nameTaken(input.name)), Effect.flatMap(written))
          }),
        )
      }),
      update: Effect.fn("Label.update")(function* (actor: Actor.Info, id: Label.ID, input: Label.UpdateInput) {
        return yield* database.transaction((transaction) =>
          findOwn(transaction, actor, id, actions.update).pipe(
            Effect.flatMap((row) =>
              transaction
                .update(label)
                .set({ name: input.name, color: input.color, updated_at: sql`now()` })
                .where(eq(label.id, id))
                .returning()
                .pipe(Effect.catchTag("EffectDrizzleQueryError", nameTaken(input.name ?? row.name))),
            ),
            Effect.flatMap(written),
          ),
        )
      }),
      archive: Effect.fn("Label.archive")(function* (actor: Actor.Info, id: Label.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* findOwn(transaction, actor, id, actions.archive)
            yield* transaction.delete(Database.Schema.task_label).where(eq(Database.Schema.task_label.label_id, id))
            const rows = yield* transaction
              .update(label)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(label.id, id))
              .returning()
            return yield* written(rows)
          }),
        )
      }),
    })
  }),
)
