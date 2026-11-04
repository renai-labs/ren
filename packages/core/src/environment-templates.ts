export * as EnvironmentTemplates from "./environment-templates.js"

import { Database } from "@ren/db/database"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Predicate, Result, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { EnvironmentProvider } from "./environment-provider.js"
import { DurableRunner } from "./durable-runner.js"
import { Primitive } from "./primitive.js"

export type Interface = Primitive.Interface<typeof EnvironmentTemplate.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/EnvironmentTemplates") {}

const notFound = new Primitive.NotFound({ message: "Environment template not found." })

const table = Database.Schema.environment_template

// oxlint-disable-next-line ren/no-comments -- environments §3 Build rule 1: one run per template and tag; the tag is a hash of the base image and the config.
const BuildRun = DurableRunner.make("EnvironmentBuild", {
  payload: { environmentTemplateId: EnvironmentTemplate.ID, tag: Schema.String },
  idempotencyKey: (payload) => `environment-build:${payload.environmentTemplateId}:${payload.tag}`,
})

export const tagOf = (base: string, config: Schema.Json) =>
  new Bun.CryptoHasher("sha256")
    .update(`${base}\0${JSON.stringify(config)}`)
    .digest("hex")
    .slice(0, 16)

const isConfig = (config: Schema.Json) => sql`${table.config} = ${JSON.stringify(config)}::jsonb`

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
  networking: row.networking,
  buildStatus: row.build_status,
  image: row.image,
  buildError: row.build_error,
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

    const providerOf = (provider: EnvironmentProvider.ID) =>
      Option.match(registry.get(provider), {
        onNone: () =>
          Effect.fail(
            new Primitive.Invalid({ message: `Ren has no environment provider ${provider}.`, field: "provider" }),
          ),
        onSome: Effect.succeed,
      })

    const checkConfig = (provider: EnvironmentProvider.Provider, config: unknown) =>
      provider
        .check(config)
        .pipe(Effect.mapError((error) => new Primitive.Invalid({ message: error.message, field: "config" })))

    const checkNetworking = (provider: EnvironmentProvider.Provider, networking: EnvironmentTemplate.Networking) =>
      networking.type === "limited" && !provider.canLimitHosts
        ? Effect.fail(
            new Primitive.Invalid({
              message: `${provider.info.title} environments cannot limit their hosts; use unrestricted networking.`,
              field: "networking",
            }),
          )
        : Effect.void

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

    // oxlint-disable-next-line ren/no-comments -- A result counts only while the template still has the config it built (EN7): a later save wins over an earlier build that ends after it.
    const build = Effect.fn("EnvironmentTemplates.build")(function* (payload: typeof BuildRun.payloadSchema.Type) {
      const row = (yield* database.db
        .select()
        .from(table)
        .where(and(eq(table.id, payload.environmentTemplateId), isNull(table.archived_at)))
        .pipe(Effect.orDie)).at(0)
      const builder = Option.flatMap(Option.fromNullishOr(row), (found) =>
        Option.flatMap(registry.get(found.provider), (provider) => provider.build),
      )
      if (!row || Option.isNone(builder) || tagOf(builder.value.base, row.config) !== payload.tag) return
      const current = and(eq(table.id, row.id), isConfig(row.config))
      yield* database.db.update(table).set({ build_status: "building" }).where(current).pipe(Effect.orDie)
      const result = yield* builder.value
        .run({ environmentTemplateId: row.id, config: row.config, tag: payload.tag })
        .pipe(Effect.result)
      yield* database.db
        .update(table)
        .set(
          Result.isSuccess(result)
            ? { build_status: "ready", image: result.success, build_error: null }
            : { build_status: "failed", build_error: result.failure.message },
        )
        .where(current)
        .pipe(Effect.orDie)
    })
    const engine = yield* WorkflowEngine.WorkflowEngine
    const ensureBuild = yield* DurableRunner.supervised(BuildRun, build)
    // oxlint-disable-next-line ren/no-comments -- EN25: a key that finished does not run again, so a return to an earlier config builds here; the provider gives a tag it built before at once.
    const requestBuild = Effect.fn("EnvironmentTemplates.requestBuild")(function* (row: typeof table.$inferSelect) {
      const builder = Option.flatMap(registry.get(row.provider), (provider) => provider.build)
      if (Option.isNone(builder)) return
      const payload = { environmentTemplateId: row.id, tag: tagOf(builder.value.base, row.config) }
      const finished = yield* BuildRun.executionId(payload).pipe(
        Effect.flatMap((executionId) => BuildRun.poll(executionId)),
        Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
      )
      yield* Option.isSome(finished) ? Effect.forkDetach(build(payload)) : ensureBuild(payload)
    })
    // oxlint-disable-next-line ren/no-comments -- At start: a template whose tag has no run, such as after a new base image (Build rule 6), builds; one left queued or building after its run finished builds again (EN25).
    yield* database.db
      .select()
      .from(table)
      .where(isNull(table.archived_at))
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) =>
          Effect.forEach(
            rows,
            (row) =>
              row.build_status === "queued" || row.build_status === "building"
                ? requestBuild(row)
                : Option.match(
                    Option.flatMap(registry.get(row.provider), (provider) => provider.build),
                    {
                      onNone: () => Effect.void,
                      onSome: (builder) =>
                        ensureBuild({ environmentTemplateId: row.id, tag: tagOf(builder.base, row.config) }),
                    },
                  ),
            { discard: true },
          ),
        ),
        Effect.catchCause((cause) => Effect.logError("The environment builds could not be checked at start", cause)),
        Effect.forkScoped,
      )
    const isBuilt = (provider: EnvironmentProvider.ID) =>
      Option.isNone(Option.flatMap(registry.get(provider), (found) => found.build))

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
        const provider = yield* providerOf(input.provider)
        const config = yield* checkConfig(provider, input.config)
        yield* checkNetworking(provider, input.networking)
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
            networking: input.networking,
            build_status: isBuilt(input.provider) ? "ready" : "queued",
          })
          .returning()
          .pipe(Effect.orDie)
        const row = rows.at(0)
        if (!row) return yield* notFound
        yield* requestBuild(row)
        return toInfo(row)
      }),
      update: Effect.fn("EnvironmentTemplates.update")(function* (
        actor: Actor.Info,
        id: EnvironmentTemplate.ID,
        input: EnvironmentTemplate.UpdateInput,
      ) {
        const saved = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* findForUpdate(transaction, actor, id)
            if (!found || found.archived_at) return yield* notFound
            if (!isAllowed(actor, actions.update))
              return yield* new Primitive.Forbidden({ message: "You cannot edit this environment template." })
            const config = Predicate.isUndefined(input.config)
              ? undefined
              : yield* checkConfig(yield* providerOf(found.provider), input.config)
            if (input.networking) yield* checkNetworking(yield* providerOf(found.provider), input.networking)
            const isRebuilt =
              config !== undefined &&
              JSON.stringify(config) !== JSON.stringify(found.config) &&
              !isBuilt(found.provider)
            const updated = yield* transaction
              .update(table)
              .set({
                name: input.name,
                description: input.description,
                config,
                sessions_per_environment: input.sessionsPerEnvironment,
                networking: input.networking,
                ...(isRebuilt && { build_status: "queued" as const }),
                updated_at: sql`now()`,
              })
              .where(eq(table.id, id))
              .returning()
            const row = updated.at(0)
            if (!row) return yield* notFound
            return { row, isRebuilt }
          }),
        )
        if (saved.isRebuilt) yield* requestBuild(saved.row)
        return toInfo(saved.row)
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
