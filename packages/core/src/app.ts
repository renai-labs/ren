export * as App from "./app.js"
export { CreateInput } from "@ren/schema/app"

import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import { Pagination } from "@ren/util/pagination"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { AppPolicy } from "./app/policy.js"
import { AppProfiles } from "./app/profiles.js"
import { AppQueries } from "./app/queries.js"
import { AppValidation } from "./app/validation.js"
import { Primitive } from "./primitive.js"

export type Interface = Primitive.Interface<typeof App.definition>
export class Service extends Context.Service<Service, Interface>()("@ren/core/App") {}

const stale = new Primitive.Conflict({ message: "The app changed. Reload before saving." })

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
                organizationId: Database.Schema.app.organization_id,
                isOwnerMember: AppQueries.isOwnerMember(actor),
                isSpaceMember: AppQueries.isSpaceMember(actor),
              })
              .from(Database.Schema.app)
              .where(
                and(
                  input.spaceId
                    ? and(
                        eq(Database.Schema.app.owner_space_id, input.spaceId),
                        eq(Database.Schema.app.organization_id, actor.organizationId),
                      )
                    : eq(Database.Schema.app.organization_id, actor.organizationId),
                  isNull(Database.Schema.app.archived_at),
                ),
              )
              .orderBy(asc(Database.Schema.app.slug))
            const visible = Pagination.page(
              rows.filter((row) => authorize(actor, "app.list", row)).map((row) => row.app),
              input,
            )
            return { ...visible, items: yield* AppQueries.infos(transaction, visible.items) }
          }),
        )
      }),
      get: Effect.fn("App.get")(function* (actor, id) {
        return yield* database.transaction((transaction) =>
          Effect.flatMap(AppQueries.find(transaction, access, actor, id), (row) =>
            AppQueries.info(transaction, row.app),
          ),
        )
      }),
      create: Effect.fn("App.create")(function* (actor, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const target = yield* AppQueries.visibleSpace(transaction, access, actor, input.ownerSpaceId)
            if (
              !authorize(actor, "app.create", {
                organizationId: actor.organizationId,
                isOwnerMember: false,
                isSpaceMember: false,
                isTargetMember: target.isMember,
              })
            )
              return yield* new Primitive.Forbidden({ message: "You cannot create apps in this space." })
            const id = App.ID.create()
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
                required_credentials: input.requiredCredentials,
                environment: input.environment,
                skills: input.skills,
                mcps: input.mcps,
              })
              .returning()
              .pipe(
                Effect.catchTag(
                  "EffectDrizzleQueryError",
                  Primitive.uniqueConflict(Database.Schema.appSlugConstraint, "An app with this slug already exists."),
                ),
              )).at(0)
            if (!row) return yield* Effect.die(new Error("App insert returned no row"))
            yield* AppValidation.writeDependencies(transaction, row, dependencies)
            yield* AppProfiles.createOwner(transaction, {
              organizationId: actor.organizationId,
              appId: id,
              spaceId: input.ownerSpaceId,
              createdBy: actor.userId,
            })
            yield* AppValidation.names(transaction, actor.organizationId, [{ row, dependsOn: dependencies }])
            return yield* AppQueries.info(transaction, row)
          }),
        )
      }),
      // oxlint-disable-next-line ren/no-comments -- profiles.md §12 rule 1 (P2): an edit replaces the whole definition and raises the revision; a stale revision is refused, never merged.
      update: Effect.fn("App.update")(function* (actor, id, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const found = yield* AppQueries.find(transaction, access, actor, id)
            if (!authorize(actor, "app.update", found))
              return yield* new Primitive.Forbidden({ message: "Only the owner space can edit this app." })
            if (found.app.revision !== input.expectedRevision) return yield* stale
            const dependencies = yield* AppValidation.dependencies(
              transaction,
              access,
              actor,
              found.app.id,
              input.dependsOn,
            )
            const row = (yield* transaction
              .update(Database.Schema.app)
              .set({
                name: input.name,
                description: input.description,
                icon: input.icon,
                required_credentials: input.requiredCredentials,
                environment: input.environment ?? null,
                skills: input.skills,
                mcps: input.mcps,
                revision: sql`${Database.Schema.app.revision} + 1`,
                updated_at: sql`now()`,
              })
              .where(
                and(eq(Database.Schema.app.id, found.app.id), eq(Database.Schema.app.revision, input.expectedRevision)),
              )
              .returning()).at(0)
            if (!row) return yield* stale
            yield* AppValidation.writeDependencies(transaction, row, dependencies)
            yield* AppValidation.names(transaction, actor.organizationId, [{ row, dependsOn: dependencies }])
            return yield* AppQueries.info(transaction, row)
          }),
        )
      }),
      // oxlint-disable-next-line ren/no-comments -- P11: archive is never refused for use; the app's profiles stay, are not reached, and come back at unarchive.
      archive: Effect.fn("App.archive")(function* (actor, id) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const found = yield* AppQueries.find(transaction, access, actor, id, { includeArchived: true })
            if (!authorize(actor, "app.archive", found))
              return yield* new Primitive.Forbidden({ message: "Only the owner space can archive this app." })
            if (found.app.archived_at) return yield* AppQueries.info(transaction, found.app)
            const row = (yield* transaction
              .update(Database.Schema.app)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(Database.Schema.app.id, id))
              .returning()).at(0)
            if (!row) return yield* AppQueries.notFound
            return yield* AppQueries.info(transaction, row)
          }),
        )
      }),
      transferOwnership: Effect.fn("App.transferOwnership")(function* (actor, id, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const found = yield* AppQueries.find(transaction, access, actor, id)
            const target = yield* AppQueries.visibleSpace(transaction, access, actor, input.spaceId)
            if (!authorize(actor, "app.transferOwnership", { ...found, isTargetMember: target.isMember }))
              return yield* new Primitive.Forbidden({ message: "Moving an app requires access to both spaces." })
            if (found.app.owner_space_id === input.spaceId) return yield* AppQueries.info(transaction, found.app)
            const row = (yield* transaction
              .update(Database.Schema.app)
              .set({ owner_space_id: input.spaceId, updated_at: sql`now()` })
              .where(eq(Database.Schema.app.id, id))
              .returning()).at(0)
            if (!row) return yield* AppQueries.notFound
            return yield* AppQueries.info(transaction, row)
          }),
        )
      }),
    })
  }),
)
