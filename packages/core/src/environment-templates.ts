export * as EnvironmentTemplates from "./environment-templates.js"

import { Database } from "@ren/db/database"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import {
  Cause,
  Context,
  DateTime,
  Duration,
  Effect,
  ErrorReporter,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Semaphore,
} from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { DurableRunner } from "./durable-runner.js"
import { EnvironmentProvider } from "./environment-provider.js"
import { MachineProvider } from "./machine-provider.js"
import { Primitive } from "./primitive.js"

export type Interface = Primitive.Interface<typeof EnvironmentTemplate.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/EnvironmentTemplates") {}

const notFound = new Primitive.NotFound({ message: "Environment template not found." })

const table = Database.Schema.environment_template

// oxlint-disable-next-line ren/no-comments -- One run per saved config (EN30): a key that finished never runs again, so each save gets the next config_version.
const BuildRun = DurableRunner.make("EnvironmentTemplateBuild", {
  payload: { environmentTemplateId: EnvironmentTemplate.ID, configVersion: Schema.Int },
  idempotencyKey: (payload) => `environment-template-build:${payload.environmentTemplateId}:${payload.configVersion}`,
})

const buildWithin = Duration.minutes(45)

const sameConfig = Schema.toEquivalence(Schema.Json)

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

    const checkNetworking = Effect.fnUntraced(function* (
      provider: EnvironmentProvider.ID,
      networking: EnvironmentTemplate.Networking | undefined,
    ) {
      if (networking?.type !== "limited" || Option.exists(registry.get(provider), (found) => found.canLimitHosts))
        return
      return yield* new Primitive.Invalid({
        message: `${provider} machines cannot keep to a list of hosts; use unrestricted networking.`,
        field: "networking",
      })
    })

    const buildOf = (provider: EnvironmentProvider.ID) => Option.flatMap(registry.get(provider), (found) => found.build)

    // oxlint-disable-next-line ren/no-comments -- EN30: one build at a time per template, so a save during a build waits. A build counts only while the template still has the config of its version. One Ren server runs the builds (EN31).
    const locks = new Map<EnvironmentTemplate.ID, Semaphore.Semaphore>()
    const build = Effect.fn("EnvironmentTemplates.build")(function* (payload: typeof BuildRun.payloadSchema.Type) {
      const lock = locks.get(payload.environmentTemplateId) ?? Semaphore.makeUnsafe(1)
      locks.set(payload.environmentTemplateId, lock)
      yield* lock.withPermit(
        Effect.gen(function* () {
          const current = and(
            eq(table.id, payload.environmentTemplateId),
            eq(table.config_version, payload.configVersion),
            isNull(table.archived_at),
          )
          const row = (yield* database.db.select().from(table).where(current).pipe(Effect.orDie)).at(0)
          const builder = Option.flatMap(Option.fromNullishOr(row), (found) => buildOf(found.provider))
          if (!row || Option.isNone(builder)) return
          yield* database.db.update(table).set({ build_status: "building" }).where(current).pipe(Effect.orDie)
          const result = yield* builder.value({ environmentTemplateId: row.id, config: row.config }).pipe(
            Effect.timeoutOrElse({
              duration: buildWithin,
              orElse: () =>
                Effect.fail(
                  new MachineProvider.Failed({
                    message: `The build did not end within ${Duration.format(buildWithin)}`,
                  }),
                ),
            }),
            Effect.result,
          )
          yield* database.db
            .update(table)
            .set(
              Result.isSuccess(result)
                ? { build_status: "ready", image: result.success, build_error: null }
                : { build_status: "failed", build_error: result.failure.message },
            )
            .where(current)
            .pipe(Effect.orDie)
          // oxlint-disable-next-line ren/no-comments -- EN38: a failed build reaches PostHog with its reason.
          if (Result.isFailure(result))
            yield* ErrorReporter.report(Cause.fail(result.failure)).pipe(
              Effect.annotateLogs({
                "ren.environment_template.id": row.id,
                "ren.organization.id": row.organization_id,
              }),
            )
        }),
      )
    })
    const queueBuild = yield* DurableRunner.supervised(BuildRun, build)
    // oxlint-disable-next-line ren/no-comments -- Templates rule 3: at start, a template left queued or building gets its build again; a run that still exists does nothing new.
    yield* database.db
      .select({ id: table.id, configVersion: table.config_version })
      .from(table)
      .where(and(isNull(table.archived_at), inArray(table.build_status, ["queued", "building"])))
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) =>
          Effect.forEach(
            rows,
            (row) => queueBuild({ environmentTemplateId: row.id, configVersion: row.configVersion }),
            {
              discard: true,
            },
          ),
        ),
      )

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
        yield* checkNetworking(input.provider, input.networking)
        const isBuilt = Option.isSome(buildOf(input.provider))
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
            build_status: isBuilt ? "queued" : "ready",
          })
          .returning()
          .pipe(Effect.orDie)
        const row = rows.at(0)
        if (!row) return yield* notFound
        if (isBuilt) yield* queueBuild({ environmentTemplateId: row.id, configVersion: row.config_version })
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
              : yield* checkConfig(found.provider, input.config)
            yield* checkNetworking(found.provider, input.networking)
            // oxlint-disable-next-line ren/no-comments -- Templates rule 2: a changed config queues a build.
            const isRebuilt =
              Option.isSome(buildOf(found.provider)) &&
              Predicate.isNotUndefined(config) &&
              !sameConfig(config, found.config)
            const updated = yield* transaction
              .update(table)
              .set({
                name: input.name,
                description: input.description,
                config,
                sessions_per_environment: input.sessionsPerEnvironment,
                networking: input.networking,
                ...(isRebuilt && { build_status: "queued" as const, config_version: found.config_version + 1 }),
                updated_at: sql`now()`,
              })
              .where(eq(table.id, id))
              .returning()
            const row = updated.at(0)
            if (!row) return yield* notFound
            return { row, isRebuilt }
          }),
        )
        if (saved.isRebuilt)
          yield* queueBuild({ environmentTemplateId: saved.row.id, configVersion: saved.row.config_version })
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
            // oxlint-disable-next-line ren/no-comments -- EN24: a space never holds a hand that cannot run. A space update reads the template with a share lock, so the two wait for each other.
            const users = yield* transaction
              .select({ name: Database.Schema.space.name })
              .from(Database.Schema.space)
              .where(
                and(eq(Database.Schema.space.environment_template_id, id), isNull(Database.Schema.space.archived_at)),
              )
              .orderBy(asc(Database.Schema.space.name))
            if (users.length > 0)
              return yield* new Primitive.Conflict({
                message: `Spaces use this environment template: ${users.map((space) => space.name).join(", ")}. Pick another hand for them first.`,
              })
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
