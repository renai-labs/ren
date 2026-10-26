export * as EnvironmentTemplates from "./environment-templates.js"

import { Database } from "@ren/db/database"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Predicate, Schema } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { EnvironmentProvider } from "./environment-provider.js"
import { Primitive } from "./primitive.js"

export type Interface = Primitive.Interface<typeof EnvironmentTemplate.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/EnvironmentTemplates") {}

const notFound = new Primitive.NotFound({ message: "Environment template not found." })

const table = Database.Schema.environment_template

const actions = {
  list: Primitive.action(EnvironmentTemplate.definition, "list"),
  get: Primitive.action(EnvironmentTemplate.definition, "get"),
  create: Primitive.action(EnvironmentTemplate.definition, "create"),
  update: Primitive.action(EnvironmentTemplate.definition, "update"),
  archive: Primitive.action(EnvironmentTemplate.definition, "archive"),
}

const toInfo = (row: typeof table.$inferSelect): EnvironmentTemplate.Info => ({
  id: row.id,
  organizationId: row.organization_id,
  name: row.name,
  description: row.description,
  provider: row.provider,
  config: row.config,
  sessionsPerEnvironment: row.sessions_per_environment,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  updatedAt: DateTime.fromDateUnsafe(row.updated_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const registry = yield* EnvironmentProvider.Registry

    const isAllowed = (actor: Actor.Info, action: string) =>
      access.isAllowed({ actor, action, resource: Access.organization })

    const inOrganization = (actor: Actor.Info) =>
      and(eq(table.organization_id, actor.organizationId), isNull(table.archived_at))

    const checkConfig = Effect.fnUntraced(function* (provider: EnvironmentProvider.ID, config: unknown) {
      const found = registry.get(provider)
      if (Option.isNone(found))
        return yield* new Primitive.Invalid({
          message: `Ren has no environment provider ${provider}.`,
          field: "provider",
        })
      return yield* found.value
        .check(config)
        .pipe(Effect.mapError((error) => new Primitive.Invalid({ message: error.message, field: "config" })))
    })

    const findForUpdate = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: EnvironmentTemplate.ID,
    ) {
      const rows = yield* transaction
        .select()
        .from(table)
        .where(and(eq(table.id, id), eq(table.organization_id, actor.organizationId)))
        .for("update")
      return rows.at(0)
    })

    const destroyEnvironments = Effect.fn("EnvironmentTemplates.destroyEnvironments")(function* (
      provider: EnvironmentProvider.ID,
      environmentTemplateId: EnvironmentTemplate.ID,
    ) {
      const environments = Database.Schema.environment
      const bound = yield* database.db
        .select({ id: environments.id, binding: environments.binding })
        .from(environments)
        .where(and(eq(environments.environment_template_id, environmentTemplateId), isNotNull(environments.binding)))
        .pipe(Effect.orDie)
      yield* Option.match(registry.get(provider), {
        onNone: () => Effect.void,
        onSome: (found) =>
          Effect.forEach(
            bound.flatMap((environment) =>
              Predicate.isNotNull(environment.binding) ? [{ id: environment.id, binding: environment.binding }] : [],
            ),
            (environment) =>
              found.destroy(environment.binding).pipe(
                Effect.andThen(
                  database.db.delete(environments).where(eq(environments.id, environment.id)).pipe(Effect.orDie),
                ),
                Effect.catch((error) =>
                  Effect.logWarning(
                    `Could not destroy environment ${environment.id} of environment template ${environmentTemplateId}`,
                    error,
                  ),
                ),
              ),
            { concurrency: 4, discard: true },
          ),
      })
    })

    return Service.of({
      list: Effect.fn("EnvironmentTemplates.list")(function* (actor: Actor.Info, input: EnvironmentTemplate.ListInput) {
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
      get: Effect.fn("EnvironmentTemplates.get")(function* (actor: Actor.Info, id: string) {
        if (!Schema.is(EnvironmentTemplate.ID)(id) || !isAllowed(actor, actions.get)) return yield* notFound
        const rows = yield* database.db
          .select()
          .from(table)
          .where(and(inOrganization(actor), eq(table.id, id)))
          .pipe(Effect.orDie)
        const row = rows.at(0)
        if (!row) return yield* notFound
        return toInfo(row)
      }),
      create: Effect.fn("EnvironmentTemplates.create")(function* (
        actor: Actor.Info,
        input: EnvironmentTemplate.CreateInput,
      ) {
        if (!isAllowed(actor, actions.create))
          return yield* new Primitive.Forbidden({
            message: "Only organization admins can create environment templates.",
          })
        const config = yield* checkConfig(input.provider, input.config)
        const rows = yield* database.db
          .insert(table)
          .values({
            id: EnvironmentTemplate.ID.create(),
            organization_id: actor.organizationId,
            name: input.name,
            description: input.description ?? null,
            provider: input.provider,
            config,
            sessions_per_environment: input.sessionsPerEnvironment,
          })
          .returning()
          .pipe(Effect.orDie)
        const row = rows.at(0)
        if (!row) return yield* notFound
        return toInfo(row)
      }),
      update: Effect.fn("EnvironmentTemplates.update")(function* (
        actor: Actor.Info,
        id: EnvironmentTemplate.ID,
        input: EnvironmentTemplate.UpdateInput,
      ) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* findForUpdate(transaction, actor, id)
            if (!found || found.archived_at) return yield* notFound
            if (!isAllowed(actor, actions.update))
              return yield* new Primitive.Forbidden({ message: "You cannot edit this environment template." })
            const config = Predicate.isUndefined(input.config)
              ? undefined
              : yield* checkConfig(found.provider, input.config)
            const updated = yield* transaction
              .update(table)
              .set({
                name: input.name,
                description: input.description,
                config,
                sessions_per_environment: input.sessionsPerEnvironment,
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
      archive: Effect.fn("EnvironmentTemplates.archive")(function* (actor: Actor.Info, id: EnvironmentTemplate.ID) {
        const archived = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* findForUpdate(transaction, actor, id)
            if (!found) return yield* notFound
            if (found.archived_at) return { info: toInfo(found), isNew: false }
            if (!isAllowed(actor, actions.archive))
              return yield* new Primitive.Forbidden({ message: "You cannot archive this environment template." })
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
        if (archived.isNew) yield* destroyEnvironments(archived.info.provider, id)
        return archived.info
      }),
    })
  }),
)
