export * as AppRelease from "./release.js"
export { ID, CreateInput } from "@ren/schema/app-release"

import { Database } from "@ren/db/database"
import { AppRelease } from "@ren/schema/app-release"
import { Pagination } from "@ren/util/pagination"
import { and, asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Access } from "../access.js"
import { Primitive } from "../primitive.js"
import { AppPolicy } from "./policy.js"
import { AppQueries } from "./queries.js"
import { AppValidation } from "./validation.js"

export type Interface = Primitive.Interface<typeof AppRelease.definition>
export class Service extends Context.Service<Service, Interface>()("@ren/core/AppRelease") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    return Service.of({
      list: Effect.fn("AppRelease.list")(function* (actor, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* AppQueries.find(transaction, access, actor, input.appId).pipe(
              Effect.catchTag("Primitive.NotFound", () => Effect.succeed(undefined)),
            )
            if (!found) return Pagination.page([], input)
            const rows = yield* transaction
              .select()
              .from(Database.Schema.app_release)
              .where(eq(Database.Schema.app_release.app_id, input.appId))
              .orderBy(asc(Database.Schema.app_release.created_at), asc(Database.Schema.app_release.id))
            const page = Pagination.page(rows, input)
            return {
              ...page,
              items: [...(yield* AppQueries.releaseInfos(transaction, page.items)).values()],
            }
          }),
        )
      }),
      get: Effect.fn("AppRelease.get")(function* (actor, id) {
        if (!id.startsWith("apr_")) return yield* AppQueries.notFound
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = (yield* transaction
              .select()
              .from(Database.Schema.app_release)
              .where(eq(Database.Schema.app_release.id, AppRelease.ID.make(id)))).at(0)
            if (!row) return yield* AppQueries.notFound
            yield* AppQueries.find(transaction, access, actor, row.app_id)
            return yield* AppQueries.releaseInfo(transaction, row)
          }),
        )
      }),
      create: Effect.fn("AppRelease.create")(function* (actor, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const found = yield* AppQueries.findOwned(transaction, access, actor, input.appId)
            if (!access.isAllowed({ actor, action: "app-release.create", resource: AppPolicy.resource(found) }))
              return yield* new Primitive.Forbidden({ message: "Only the owner space can create releases." })
            const latest = (yield* transaction
              .select()
              .from(Database.Schema.app_release)
              .where(eq(Database.Schema.app_release.id, found.app.latest_release_id))).at(0)
            if (!latest) return yield* Effect.die(new Error("Latest release is missing"))
            const dependencies = yield* AppValidation.dependencies(
              transaction,
              access,
              actor,
              input.appId,
              input.dependsOn,
            )
            const current = yield* AppQueries.releaseInfo(transaction, latest)
            const content = AppValidation.execution(input)
            if (AppValidation.execution(current) === content) return current
            const version = input.version ?? AppRelease.nextVersion(latest.version, input.bump)
            const existing = (yield* transaction
              .select()
              .from(Database.Schema.app_release)
              .where(
                and(
                  eq(Database.Schema.app_release.app_id, input.appId),
                  eq(Database.Schema.app_release.version, version),
                ),
              )).at(0)
            if (existing) {
              const info = yield* AppQueries.releaseInfo(transaction, existing)
              if (AppValidation.execution(info) === content) return info
              return yield* new Primitive.Conflict({
                message: "This version already has different execution configuration.",
              })
            }
            if (found.app.latest_release_id !== input.expectedLatestReleaseId)
              return yield* new Primitive.Conflict({
                message: "The latest app release changed. Reload before creating a successor.",
              })
            if (Bun.semver.order(version, latest.version) <= 0)
              return yield* new Primitive.Conflict({
                message: "A new version must be greater than the latest release.",
              })
            const row = (yield* transaction
              .insert(Database.Schema.app_release)
              .values({
                id: AppRelease.ID.create(),
                app_id: input.appId,
                version,
                required_credentials: input.requiredCredentials,
                environment: input.environment,
                skills: input.skills,
                mcps: input.mcps,
              })
              .returning()
              .pipe(
                Effect.catchTag(
                  "EffectDrizzleQueryError",
                  Primitive.uniqueConflict("app_release_app_id_version_unique", "This app version already exists."),
                ),
              )).at(0)
            if (!row) return yield* Effect.die(new Error("Release insert returned no row"))
            yield* AppValidation.writeDependencies(transaction, row.id, dependencies)
            yield* transaction
              .update(Database.Schema.app)
              .set({ latest_release_id: row.id, updated_at: sql`now()` })
              .where(eq(Database.Schema.app.id, input.appId))
            yield* AppValidation.finalGraph(transaction, {
              organizationId: actor.organizationId,
              spaceIds: yield* AppQueries.consumers(transaction, input.appId),
            })
            return yield* AppQueries.releaseInfo(transaction, row)
          }),
        )
      }),
    })
  }),
)
