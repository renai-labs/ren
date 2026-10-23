export * as App from "./app.js"
export { CreateInput } from "@ren/schema/app"

import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import { AppRelease } from "@ren/schema/app-release"
import { SpaceApp } from "@ren/schema/space-app"
import { Pagination } from "@ren/util/pagination"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { AppPolicy } from "./app/policy.js"
import { AppQueries } from "./app/queries.js"
import { AppValidation } from "./app/validation.js"
import { Primitive } from "./primitive.js"

export type Interface = Primitive.Interface<typeof App.definition>
export class Service extends Context.Service<Service, Interface>()("@ren/core/App") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const authorize = (actor: Actor.Info, action: string, holds: AppPolicy.Holds) =>
      access.isAllowed({ actor, action, resource: AppPolicy.resource(holds) })
    return Service.of({
      list: Effect.fn("App.list")(function* (actor, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* transaction
              .select({
                app: Database.Schema.app,
                isOwnerMember: AppQueries.isOwnerMember(actor),
                isSpaceMember: AppQueries.isSpaceMember(actor),
              })
              .from(Database.Schema.app)
              .where(
                and(
                  input.spaceId
                    ? and(
                        AppQueries.isInSpace(input.spaceId),
                        sql`exists (select 1 from space where id = ${input.spaceId} and organization_id = ${actor.organizationId})`,
                      )
                    : eq(Database.Schema.app.organization_id, actor.organizationId),
                  isNull(Database.Schema.app.archived_at),
                ),
              )
              .orderBy(asc(Database.Schema.app.slug))
            const visible = rows
              .filter((row) => authorize(actor, "app.list", row))
              .map((row) => AppQueries.appInfo(row.app))
            return Pagination.page(visible, input)
          }),
        )
      }),
      get: Effect.fn("App.get")(function* (actor, id) {
        return yield* database.transaction((transaction) =>
          Effect.map(AppQueries.find(transaction, access, actor, id), (row) => AppQueries.appInfo(row.app)),
        )
      }),
      create: Effect.fn("App.create")(function* (actor, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const target = yield* AppQueries.visibleSpace(transaction, access, actor, input.ownerSpaceId)
            if (
              !authorize(actor, "app.create", {
                isOwnerMember: false,
                isSpaceMember: false,
                isTargetMember: target.isMember,
              })
            )
              return yield* new Primitive.Forbidden({ message: "You cannot create apps in this space." })
            const id = App.ID.create()
            const releaseId = AppRelease.ID.create()
            if (input.dependsOn.includes(input.slug))
              return yield* new Primitive.Conflict({ message: `App “${input.slug}” cannot depend on itself.` })
            const dependencies = yield* AppValidation.dependencies(transaction, access, actor, id, input.dependsOn)
            const row = (yield* transaction
              .insert(Database.Schema.app)
              .values({
                id,
                slug: input.slug,
                organization_id: actor.organizationId,
                owner_space_id: input.ownerSpaceId,
                name: input.name,
                description: input.description,
                icon: input.icon,
                latest_release_id: releaseId,
              })
              .returning()
              .pipe(
                Effect.catchTag(
                  "EffectDrizzleQueryError",
                  Primitive.uniqueConflict(Database.Schema.appSlugConstraint, "An app with this slug already exists."),
                ),
              )).at(0)
            yield* transaction.insert(Database.Schema.app_release).values({
              id: releaseId,
              app_id: id,
              version: "0.0.1",
              required_credentials: input.requiredCredentials,
              environment: input.environment,
              skills: input.skills,
              mcps: input.mcps,
            })
            yield* AppValidation.writeDependencies(transaction, releaseId, dependencies)
            if (!row) return yield* Effect.die(new Error("App insert returned no row"))
            yield* AppValidation.finalGraph(transaction, {
              organizationId: actor.organizationId,
              spaceIds: [input.ownerSpaceId],
            })
            return AppQueries.appInfo(row)
          }),
        )
      }),
      update: Effect.fn("App.update")(function* (actor, id, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor, { graph: false })
            const found = yield* AppQueries.findOwned(transaction, access, actor, id)
            if (!authorize(actor, "app.update", found))
              return yield* new Primitive.Forbidden({ message: "Only the owner space can edit this app." })
            const row = (yield* transaction
              .update(Database.Schema.app)
              .set({ name: input.name, description: input.description, icon: input.icon, updated_at: sql`now()` })
              .where(eq(Database.Schema.app.id, id))
              .returning()).at(0)
            if (!row) return yield* AppQueries.notFound
            return AppQueries.appInfo(row)
          }),
        )
      }),
      archive: Effect.fn("App.archive")(function* (actor, id) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const found = yield* AppQueries.findOwned(transaction, access, actor, id, { includeArchived: true })
            if (!authorize(actor, "app.archive", found))
              return yield* new Primitive.Forbidden({ message: "Only the owner space can archive this app." })
            if (found.app.archived_at) return AppQueries.appInfo(found.app)
            const uses = yield* transaction
              .select({ name: Database.Schema.space.name, organizationId: Database.Schema.space.organization_id })
              .from(Database.Schema.space_app)
              .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.space_app.space_id))
              .where(and(eq(Database.Schema.space_app.app_id, id), isNull(Database.Schema.space_app.archived_at)))
              .orderBy(asc(Database.Schema.space.name))
            const own = uses.filter((use) => use.organizationId === actor.organizationId).map((use) => use.name)
            const foreign = uses.length - own.length
            if (uses.length)
              return yield* new Primitive.Conflict({
                message: `App ${found.app.slug} is still used in ${[
                  ...(own.length ? [`spaces ${own.join(", ")}`] : []),
                  ...(foreign
                    ? [foreign === 1 ? "1 space of another organization" : `${foreign} spaces of other organizations`]
                    : []),
                ].join(" and ")}. Remove those uses first.`,
              })
            const rows = yield* transaction
              .update(Database.Schema.app)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(Database.Schema.app.id, id))
              .returning()
            yield* AppValidation.finalGraph(transaction, {
              organizationId: actor.organizationId,
              spaceIds: found.app.owner_space_id ? [found.app.owner_space_id] : [],
            })
            const row = rows.at(0)
            if (!row) return yield* AppQueries.notFound
            return AppQueries.appInfo(row)
          }),
        )
      }),
      transferOwnership: Effect.fn("App.transferOwnership")(function* (actor, id, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const found = yield* AppQueries.findOwned(transaction, access, actor, id)
            const target = yield* AppQueries.visibleSpace(transaction, access, actor, input.spaceId)
            if (!authorize(actor, "app.transferOwnership", { ...found, isTargetMember: target.isMember }))
              return yield* new Primitive.Forbidden({ message: "Moving an app requires access to both spaces." })
            if (found.app.owner_space_id === input.spaceId) return AppQueries.appInfo(found.app)
            const targetUse = yield* AppQueries.activeUse(transaction, input.spaceId, id)
            if (targetUse)
              yield* transaction
                .update(Database.Schema.space_app)
                .set({ archived_at: sql`now()` })
                .where(eq(Database.Schema.space_app.id, targetUse.id))
            if (input.retainUse && found.app.owner_space_id)
              yield* transaction
                .insert(Database.Schema.space_app)
                .values({ id: SpaceApp.ID.create(), space_id: found.app.owner_space_id, app_id: id })
                .onConflictDoNothing()
            const row = (yield* transaction
              .update(Database.Schema.app)
              .set({ owner_space_id: input.spaceId, updated_at: sql`now()` })
              .where(eq(Database.Schema.app.id, id))
              .returning()).at(0)
            yield* AppValidation.finalGraph(transaction, {
              organizationId: actor.organizationId,
              spaceIds: [input.spaceId, ...(found.app.owner_space_id ? [found.app.owner_space_id] : [])],
            })
            if (!row) return yield* AppQueries.notFound
            return AppQueries.appInfo(row)
          }),
        )
      }),
    })
  }),
)
