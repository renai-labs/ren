export * as Label from "./label.js"

import { Database } from "@ren/db/database"
import { Label } from "@ren/schema/label"
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
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
  name: row.name,
  color: row.color,
  isSystem: !row.organization_id,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  updatedAt: DateTime.fromDateUnsafe(row.updated_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

const visibleTo = (actor: Actor.Info) =>
  and(
    or(eq(Database.Schema.label.organization_id, actor.organizationId), isNull(Database.Schema.label.organization_id)),
    isNull(Database.Schema.label.archived_at),
  )

const nameTaken = (name: string) =>
  Primitive.uniqueConflict(Database.Schema.labelNameConstraint, `A label named ${name} already exists.`)

const written = (rows: ReadonlyArray<Row>) => {
  const row = rows.at(0)
  return row ? Effect.succeed(toInfo(row)) : Effect.fail(notFound)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const allowed = (actor: Actor.Info, action: string) =>
      access.isAllowed({ actor, action, resource: TaskPolicy.organization })
        ? Effect.void
        : Effect.fail(new Primitive.Forbidden({ message: "You cannot change labels." }))

    const findOwn = Effect.fnUntraced(function* (transaction: Database.Transaction, actor: Actor.Info, id: Label.ID) {
      const row = (yield* transaction
        .select()
        .from(Database.Schema.label)
        .where(and(eq(Database.Schema.label.id, id), visibleTo(actor)))
        .for("update")).at(0)
      if (!row) return yield* notFound
      if (!row.organization_id) return yield* new Primitive.Forbidden({ message: "System labels cannot change." })
      return row
    })

    return Service.of({
      list: Effect.fn("Label.list")(function* (actor: Actor.Info, input: Label.ListInput) {
        if (!access.isAllowed({ actor, action: actions.list, resource: TaskPolicy.organization }))
          return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* transaction
              .select()
              .from(Database.Schema.label)
              .where(visibleTo(actor))
              .orderBy(
                sql`${Database.Schema.label.organization_id} is not null`,
                sql`lower(${Database.Schema.label.name})`,
                asc(Database.Schema.label.id),
              )
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(Database.Schema.label)
              .where(visibleTo(actor))
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
        yield* allowed(actor, actions.create)
        return yield* database.transaction((transaction) =>
          transaction
            .insert(Database.Schema.label)
            .values({
              id: Label.ID.create(),
              organization_id: actor.organizationId,
              name: input.name,
              color: input.color ?? null,
            })
            .returning()
            .pipe(Effect.catchTag("EffectDrizzleQueryError", nameTaken(input.name)), Effect.flatMap(written)),
        )
      }),
      update: Effect.fn("Label.update")(function* (actor: Actor.Info, id: Label.ID, input: Label.UpdateInput) {
        yield* allowed(actor, actions.update)
        return yield* database.transaction((transaction) =>
          findOwn(transaction, actor, id).pipe(
            Effect.flatMap((row) =>
              transaction
                .update(Database.Schema.label)
                .set({ name: input.name, color: input.color, updated_at: sql`now()` })
                .where(eq(Database.Schema.label.id, id))
                .returning()
                .pipe(Effect.catchTag("EffectDrizzleQueryError", nameTaken(input.name ?? row.name))),
            ),
            Effect.flatMap(written),
          ),
        )
      }),
      archive: Effect.fn("Label.archive")(function* (actor: Actor.Info, id: Label.ID) {
        yield* allowed(actor, actions.archive)
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* findOwn(transaction, actor, id)
            yield* transaction.delete(Database.Schema.task_label).where(eq(Database.Schema.task_label.label_id, id))
            const rows = yield* transaction
              .update(Database.Schema.label)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(Database.Schema.label.id, id))
              .returning()
            return yield* written(rows)
          }),
        )
      }),
    })
  }),
)
