export * as Environments from "./environments.js"

import { Database } from "@ren/db/database"
import { Environment } from "@ren/schema/environment"
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Predicate, Schema } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { HandProvider } from "./hand-provider.js"
import { Primitive } from "./primitive.js"
import { SpacePolicy } from "./space/policy.js"

export type Interface = Primitive.Interface<typeof Environment.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/Environments") {}

const notFound = new Primitive.NotFound({ message: "Environment not found." })

const table = Database.Schema.environment

const actions = {
  list: Primitive.action(Environment.definition, "list"),
  get: Primitive.action(Environment.definition, "get"),
  create: Primitive.action(Environment.definition, "create"),
  update: Primitive.action(Environment.definition, "update"),
  archive: Primitive.action(Environment.definition, "archive"),
}

const toInfo = (row: typeof table.$inferSelect): Environment.Info => ({
  id: row.id,
  organizationId: row.organization_id,
  name: row.name,
  description: row.description,
  provider: row.provider,
  config: row.config,
  sessionsPerHand: row.sessions_per_hand,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  updatedAt: DateTime.fromDateUnsafe(row.updated_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const registry = yield* HandProvider.Registry

    const isAllowed = (actor: Actor.Info, action: string) =>
      access.isAllowed({ actor, action, resource: SpacePolicy.organization })

    const inOrganization = (actor: Actor.Info) =>
      and(eq(table.organization_id, actor.organizationId), isNull(table.archived_at))

    const checkConfig = Effect.fnUntraced(function* (provider: HandProvider.ID, config: unknown) {
      const found = registry.get(provider)
      if (Option.isNone(found))
        return yield* new Primitive.Invalid({
          message: `Ren has no hand provider ${provider}.`,
          field: "provider",
        })
      return yield* found.value
        .check(config)
        .pipe(Effect.mapError((error) => new Primitive.Invalid({ message: error.message, field: "config" })))
    })

    const findForUpdate = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: Environment.ID,
    ) {
      const rows = yield* transaction
        .select()
        .from(table)
        .where(and(eq(table.id, id), eq(table.organization_id, actor.organizationId)))
        .for("update")
      return rows.at(0)
    })

    const destroyHands = Effect.fn("Environments.destroyHands")(function* (
      provider: HandProvider.ID,
      environmentId: Environment.ID,
    ) {
      const hands = Database.Schema.hand
      const bound = yield* database.db
        .select({ id: hands.id, binding: hands.binding })
        .from(hands)
        .where(and(eq(hands.environment_id, environmentId), isNotNull(hands.binding)))
        .pipe(Effect.orDie)
      yield* Option.match(registry.get(provider), {
        onNone: () => Effect.void,
        onSome: (found) =>
          Effect.forEach(
            bound.flatMap((hand) =>
              Predicate.isNotNull(hand.binding) ? [{ id: hand.id, binding: hand.binding }] : [],
            ),
            (hand) =>
              found.destroy(hand.binding).pipe(
                Effect.andThen(database.db.delete(hands).where(eq(hands.id, hand.id)).pipe(Effect.orDie)),
                Effect.catch((error) =>
                  Effect.logWarning(`Could not destroy hand ${hand.id} of environment ${environmentId}`, error),
                ),
              ),
            { concurrency: 4, discard: true },
          ),
      })
    })

    return Service.of({
      list: Effect.fn("Environments.list")(function* (actor: Actor.Info, input: Environment.ListInput) {
        const empty = { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
        if (!isAllowed(actor, actions.list)) return empty
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const where = inOrganization(actor)
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
      get: Effect.fn("Environments.get")(function* (actor: Actor.Info, id: string) {
        if (!Schema.is(Environment.ID)(id) || !isAllowed(actor, actions.get)) return yield* notFound
        const rows = yield* database.db
          .select()
          .from(table)
          .where(and(inOrganization(actor), eq(table.id, id)))
          .pipe(Effect.orDie)
        const row = rows.at(0)
        if (!row) return yield* notFound
        return toInfo(row)
      }),
      create: Effect.fn("Environments.create")(function* (actor: Actor.Info, input: Environment.CreateInput) {
        if (!isAllowed(actor, actions.create))
          return yield* new Primitive.Forbidden({ message: "Only organization admins can create environments." })
        const config = yield* checkConfig(input.provider, input.config)
        const rows = yield* database.db
          .insert(table)
          .values({
            id: Environment.ID.create(),
            organization_id: actor.organizationId,
            name: input.name,
            description: input.description ?? null,
            provider: input.provider,
            config,
            sessions_per_hand: input.sessionsPerHand,
          })
          .returning()
          .pipe(Effect.orDie)
        const row = rows.at(0)
        if (!row) return yield* notFound
        return toInfo(row)
      }),
      update: Effect.fn("Environments.update")(function* (
        actor: Actor.Info,
        id: Environment.ID,
        input: Environment.UpdateInput,
      ) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* findForUpdate(transaction, actor, id)
            if (!found || found.archived_at) return yield* notFound
            if (!isAllowed(actor, actions.update))
              return yield* new Primitive.Forbidden({ message: "You cannot edit this environment." })
            const config = Predicate.isUndefined(input.config)
              ? undefined
              : yield* checkConfig(found.provider, input.config)
            const updated = yield* transaction
              .update(table)
              .set({
                name: input.name,
                description: input.description,
                config,
                sessions_per_hand: input.sessionsPerHand,
                updated_at: sql`now()`,
              })
              .where(eq(table.id, id))
              .returning()
            const row = updated.at(0)
            if (!row) return yield* notFound
            return toInfo(row)
          }),
        )
      }),
      archive: Effect.fn("Environments.archive")(function* (actor: Actor.Info, id: Environment.ID) {
        const archived = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* findForUpdate(transaction, actor, id)
            if (!found) return yield* notFound
            if (found.archived_at) return { info: toInfo(found), isNew: false }
            if (!isAllowed(actor, actions.archive))
              return yield* new Primitive.Forbidden({ message: "You cannot archive this environment." })
            const updated = yield* transaction
              .update(table)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(table.id, id))
              .returning()
            const row = updated.at(0)
            if (!row) return yield* notFound
            return { info: toInfo(row), isNew: true }
          }),
        )
        if (archived.isNew) yield* destroyHands(archived.info.provider, id)
        return archived.info
      }),
    })
  }),
)
