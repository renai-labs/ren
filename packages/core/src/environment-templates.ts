export * as EnvironmentTemplates from "./environment-templates.js"

import { Database } from "@ren/db/database"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import {
  Cause,
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  ErrorReporter,
  Layer,
  Option,
  Predicate,
  Schedule,
  Schema,
} from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { EnvironmentProvider } from "./environment-provider.js"
import { MachineProvider } from "./machine-provider.js"
import { Primitive } from "./primitive.js"

export type Interface = Primitive.Interface<typeof EnvironmentTemplate.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/EnvironmentTemplates") {}

const notFound = new Primitive.NotFound({ message: "Environment template not found." })

const table = Database.Schema.environment_template

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

    // oxlint-disable-next-line ren/no-comments -- A build's end counts only while the template still has the config it built (EN30); otherwise Ren forgets the build, and the newest config builds next.
    const finish = Effect.fnUntraced(function* (
      row: typeof table.$inferSelect,
      version: number,
      values: Partial<typeof table.$inferInsert>,
    ) {
      const counted = yield* database.db
        .update(table)
        .set({ ...values, build_id: null, build_version: null })
        .where(and(eq(table.id, row.id), eq(table.config_version, version)))
        .returning({ id: table.id })
        .pipe(Effect.orDie)
      if (counted.length === 0)
        yield* database.db
          .update(table)
          .set({ build_id: null, build_version: null })
          .where(eq(table.id, row.id))
          .pipe(Effect.orDie)
    })

    const record = Effect.fnUntraced(function* (
      row: typeof table.$inferSelect,
      version: number,
      state: MachineProvider.BuildState,
    ) {
      if (state._tag === "Building") {
        yield* database.db
          .update(table)
          .set({ build_status: "building", build_id: state.id, build_version: version })
          .where(and(eq(table.id, row.id), eq(table.config_version, version), isNull(table.build_id)))
          .pipe(Effect.orDie)
        return
      }
      if (state._tag === "Ready") {
        yield* finish(row, version, {
          build_status: "ready",
          image: state.image,
          image_config: row.config,
          build_error: null,
        })
        return
      }
      yield* finish(row, version, { build_status: "failed", build_error: state.reason })
      // oxlint-disable-next-line ren/no-comments -- EN38: a failed build reaches PostHog with its reason.
      yield* ErrorReporter.report(Cause.fail(new MachineProvider.Failed({ message: state.reason }))).pipe(
        Effect.annotateLogs({ "ren.environment_template.id": row.id, "ren.organization.id": row.organization_id }),
      )
    })

    // oxlint-disable-next-line ren/no-comments -- EN30: the provider owns each build; Ren keeps its id and asks. One build at a time per template: a template with a build in progress asks about it; one queued without one starts its newest config. A Ren restart finds the build it started. One Ren server runs this (EN31).
    const checkBuild = Effect.fnUntraced(function* (row: typeof table.$inferSelect) {
      const builder = buildOf(row.provider)
      if (Option.isNone(builder)) return
      // ast-grep-ignore: no-nullish-comparison, -- version 0 is the first config's.
      if (row.build_id && row.build_version !== null) {
        yield* record(row, row.build_version, yield* builder.value.status(row.build_id))
        return
      }
      const started = yield* builder.value
        .start({ environmentTemplateId: row.id, config: row.config })
        .pipe(Effect.catch((error) => Effect.succeed({ _tag: "Failed", reason: error.message } as const)))
      yield* record(row, row.config_version, started)
    })

    const checkEvery = yield* Config.Duration("ENVIRONMENT_TEMPLATE_BUILD_CHECK").pipe(
      Config.withDefault(Duration.seconds(10)),
    )
    yield* database.db
      .select()
      .from(table)
      .where(and(isNull(table.archived_at), inArray(table.build_status, ["queued", "building"])))
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) =>
          Effect.forEach(
            rows,
            (row) =>
              checkBuild(row).pipe(
                Effect.catch((error) => Effect.logWarning(`The build of template ${row.id} is unknown`, error)),
              ),
            { discard: true },
          ),
        ),
        Effect.repeat(Schedule.spaced(checkEvery)),
        Effect.withErrorReporting,
        Effect.forkScoped,
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
            const spacesUsing = yield* transaction
              .select({ name: Database.Schema.space.name })
              .from(Database.Schema.space)
              .where(
                and(eq(Database.Schema.space.environment_template_id, id), isNull(Database.Schema.space.archived_at)),
              )
              .orderBy(asc(Database.Schema.space.name))
            if (spacesUsing.length > 0)
              return yield* new Primitive.Conflict({
                message: `Spaces use this environment template: ${spacesUsing.map((space) => space.name).join(", ")}. Pick another hand for them first.`,
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
