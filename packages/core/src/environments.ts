export * as Environments from "./environments.js"

import { Database } from "@ren/db/database"
import { Environment } from "@ren/schema/environment"
import type { Space } from "@ren/schema/space"
import { and, asc, count, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Predicate, Schema } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { HandProvider } from "./hand-provider.js"
import { Primitive } from "./primitive.js"
import { SpacePolicy } from "./space/policy.js"
import { SpaceQueries } from "./space/queries.js"

export type Interface = Primitive.Interface<typeof Environment.definition> & {
  readonly providers: Effect.Effect<ReadonlyArray<Environment.ProviderInfo>>
}

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

const select = (transaction: Database.Transaction, actor: Actor.Info) =>
  transaction
    .select({ environment: table, membershipId: SpaceQueries.membership.id })
    .from(table)
    .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, table.space_id))
    .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))

type Row = Effect.Success<ReturnType<typeof select>>[number]

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const registry = yield* HandProvider.Registry

    const visibleTo = (actor: Actor.Info) =>
      and(
        eq(table.organization_id, actor.organizationId),
        isNull(table.archived_at),
        isNull(Database.Schema.space.archived_at),
        SpacePolicy.filter(access.plan(actor, actions.get)),
      )

    const toInfo =
      (actor: Actor.Info) =>
      (row: Row): Environment.Info => {
        const resource = SpacePolicy.resource(row.membershipId)
        return {
          id: row.environment.id,
          spaceId: row.environment.space_id,
          name: row.environment.name,
          description: row.environment.description,
          provider: row.environment.provider,
          config: row.environment.config,
          sessionsPerHand: row.environment.sessions_per_hand,
          canUpdate: access.isAllowed({ actor, action: actions.update, resource }),
          canArchive: access.isAllowed({ actor, action: actions.archive, resource }),
          createdAt: DateTime.fromDateUnsafe(row.environment.created_at),
          updatedAt: DateTime.fromDateUnsafe(row.environment.updated_at),
          archivedAt: row.environment.archived_at && DateTime.fromDateUnsafe(row.environment.archived_at),
        }
      }

    const checked = Effect.fnUntraced(function* (provider: string, config: unknown) {
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

    const findVisible = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: Environment.ID,
    ) {
      const rows = yield* select(transaction, actor)
        .where(and(eq(table.id, id), eq(table.organization_id, actor.organizationId)))
        .for("update", { of: table })
      const row = rows.at(0)
      if (!row) return
      const resource = SpacePolicy.resource(row.membershipId)
      if (!access.isAllowed({ actor, action: actions.get, resource })) return
      return { row, resource }
    })

    const spaceOf = Effect.fnUntraced(function* (
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
      const row = rows.at(0)
      if (!row) return
      return SpacePolicy.resource(row.membershipId)
    })

    const destroyHands = Effect.fn("Environments.destroyHands")(function* (
      provider: string,
      environmentId: Environment.ID,
    ) {
      const hands = yield* database.db
        .delete(Database.Schema.hand)
        .where(and(eq(Database.Schema.hand.environment_id, environmentId), isNotNull(Database.Schema.hand.binding)))
        .returning({ binding: Database.Schema.hand.binding })
        .pipe(Effect.orDie)
      yield* Option.match(registry.get(provider), {
        onNone: () => Effect.void,
        onSome: (found) =>
          Effect.forEach(
            hands.map((hand) => hand.binding).filter(Predicate.isNotNull),
            (binding) =>
              found
                .destroy(binding)
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning(`Could not destroy a hand of environment ${environmentId}`, error),
                  ),
                ),
            { concurrency: 4, discard: true },
          ),
      })
    })

    return Service.of({
      list: Effect.fn("Environments.list")(function* (actor: Actor.Info, input: Environment.ListInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            if (!access.isAllowed({ actor, action: actions.list, resource: SpacePolicy.organization }))
              return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
            const where: SQL | undefined = and(
              visibleTo(actor),
              input.spaceId ? eq(table.space_id, input.spaceId) : undefined,
            )
            const rows = yield* select(transaction, actor)
              .where(where)
              .orderBy(asc(table.created_at), asc(table.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(table)
              .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, table.space_id))
              .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
              .where(where)
            return {
              items: rows.map(toInfo(actor)),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      get: Effect.fn("Environments.get")(function* (actor: Actor.Info, idOrSlug: string) {
        if (!Schema.is(Environment.ID)(idOrSlug)) return yield* notFound
        const rows = yield* database.transaction((transaction) =>
          select(transaction, actor).where(and(visibleTo(actor), eq(table.id, idOrSlug))),
        )
        const row = rows.at(0)
        if (!row) return yield* notFound
        return toInfo(actor)(row)
      }),
      create: Effect.fn("Environments.create")(function* (actor: Actor.Info, input: Environment.CreateInput) {
        const config = yield* checked(input.provider, input.config)
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const resource = yield* spaceOf(transaction, actor, input.spaceId)
            if (!resource) return yield* new Primitive.NotFound({ message: "Space not found." })
            if (!access.isAllowed({ actor, action: actions.create, resource }))
              return yield* new Primitive.Forbidden({ message: "Join the space to create environments in it." })
            const id = Environment.ID.create()
            yield* transaction.insert(table).values({
              id,
              organization_id: actor.organizationId,
              space_id: input.spaceId,
              name: input.name,
              description: input.description ?? null,
              provider: input.provider,
              config,
              sessions_per_hand: input.sessionsPerHand,
            })
            const rows = yield* select(transaction, actor).where(eq(table.id, id))
            const row = rows.at(0)
            if (!row) return yield* notFound
            return toInfo(actor)(row)
          }),
        )
      }),
      update: Effect.fn("Environments.update")(function* (
        actor: Actor.Info,
        id: Environment.ID,
        input: Environment.UpdateInput,
      ) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const visible = yield* findVisible(transaction, actor, id)
            if (!visible || visible.row.environment.archived_at) return yield* notFound
            if (!access.isAllowed({ actor, action: actions.update, resource: visible.resource }))
              return yield* new Primitive.Forbidden({ message: "You cannot edit this environment." })
            const config = Predicate.isUndefined(input.config)
              ? undefined
              : yield* checked(visible.row.environment.provider, input.config)
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
            const environment = updated.at(0)
            if (!environment) return yield* notFound
            return toInfo(actor)({ ...visible.row, environment })
          }),
        )
      }),
      archive: Effect.fn("Environments.archive")(function* (actor: Actor.Info, id: Environment.ID) {
        const archived = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const visible = yield* findVisible(transaction, actor, id)
            if (!visible) return yield* notFound
            if (visible.row.environment.archived_at) return { info: toInfo(actor)(visible.row), isNew: false }
            if (!access.isAllowed({ actor, action: actions.archive, resource: visible.resource }))
              return yield* new Primitive.Forbidden({ message: "You cannot archive this environment." })
            const updated = yield* transaction
              .update(table)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(table.id, id))
              .returning()
            const environment = updated.at(0)
            if (!environment) return yield* notFound
            return { info: toInfo(actor)({ ...visible.row, environment }), isNew: true }
          }),
        )
        if (archived.isNew) yield* destroyHands(archived.info.provider, id)
        return archived.info
      }),
      providers: Effect.sync(() => registry.providers.map((provider) => provider.info)).pipe(
        Effect.withSpan("Environments.providers"),
      ),
    })
  }),
)
