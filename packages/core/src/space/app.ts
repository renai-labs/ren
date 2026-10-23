export * as SpaceApp from "./app.js"
export { ofOwner } from "@ren/schema/space-app"

import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import { SpaceApp } from "@ren/schema/space-app"
import { Pagination } from "@ren/util/pagination"
import { eq, sql } from "drizzle-orm"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Context, DateTime, Effect, Layer, Option } from "effect"
import { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { AppPolicy } from "../app/policy.js"
import { AppQueries } from "../app/queries.js"
import { AppValidation } from "../app/validation.js"
import { Primitive } from "../primitive.js"

export type Interface = Primitive.Interface<typeof SpaceApp.definition>
export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceApp") {}

const notFound = new Primitive.NotFound({ message: "Space app not found." })

export const install = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  access: Access.Interface,
  actor: Actor.Info,
  input: SpaceApp.CreateInput,
  options: { readonly path?: ReadonlyArray<App.ID>; readonly isPinUpdate?: boolean } = {},
): Effect.fn.Return<
  {
    readonly app: typeof Database.Schema.app.$inferSelect
    readonly use: typeof Database.Schema.space_app.$inferSelect | undefined
  },
  EffectDrizzleQueryError | Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict
> {
  const found = yield* AppQueries.find(transaction, access, actor, input.appId)
  const path = options.path ?? []
  if (path.includes(input.appId))
    return yield* new Primitive.Conflict({ message: `Dependency cycle: ${[...path, input.appId].join(" -> ")}` })
  const use = yield* AppQueries.activeUse(transaction, input.spaceId, input.appId)
  const isOwner = found.app.owner_space_id === input.spaceId
  if (isOwner && input.pinnedReleaseId)
    return yield* new Primitive.Conflict({ message: "An owner relationship cannot be pinned." })
  const requestedPin = use && !options.isPinUpdate ? use.pinned_release_id : input.pinnedReleaseId
  const release = yield* AppQueries.selectedRelease(transaction, found.app, isOwner ? undefined : requestedPin)
  const dependencies = yield* transaction
    .select()
    .from(Database.Schema.app_release_dependency)
    .where(eq(Database.Schema.app_release_dependency.app_release_id, release.id))
  yield* Effect.forEach(dependencies, (dependency) =>
    install(
      transaction,
      access,
      actor,
      { spaceId: input.spaceId, appId: dependency.dependency_app_id },
      { path: [...path, input.appId] },
    ),
  )
  if (isOwner) return { app: found.app, use: undefined }
  if (use) {
    if (!options.isPinUpdate) return { app: found.app, use }
    const updated = (yield* transaction
      .update(Database.Schema.space_app)
      .set({ pinned_release_id: input.pinnedReleaseId })
      .where(eq(Database.Schema.space_app.id, use.id))
      .returning()).at(0)
    return { app: found.app, use: updated }
  }
  const created = (yield* transaction
    .insert(Database.Schema.space_app)
    .values({
      id: SpaceApp.ID.create(),
      space_id: input.spaceId,
      app_id: input.appId,
      pinned_release_id: input.pinnedReleaseId,
    })
    .returning()
    .pipe(
      Effect.catchTag(
        "EffectDrizzleQueryError",
        Primitive.uniqueConflict(Database.Schema.spaceAppConstraint, "This app is already installed in the space."),
      ),
    )).at(0)
  return { app: found.app, use: created }
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const space = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      spaceId: SpaceApp.Info["spaceId"],
      action: string,
    ) {
      const target = yield* AppQueries.visibleSpace(transaction, access, actor, spaceId)
      if (
        !access.isAllowed({
          actor,
          action,
          resource: AppPolicy.resource({ isOwnerMember: false, isSpaceMember: false, isTargetMember: target.isMember }),
        })
      )
        return yield* new Primitive.Forbidden({ message: "You cannot manage apps in this space." })
    })
    const get = Effect.fnUntraced(function* (transaction: Database.Transaction, actor: Actor.Info, id: string) {
      const owner = SpaceApp.ownerApp(SpaceApp.ID.make(id))
      if (Option.isSome(owner)) {
        const found = yield* AppQueries.find(transaction, access, actor, owner.value)
        if (!found.app.owner_space_id) return yield* notFound
        yield* space(transaction, actor, found.app.owner_space_id, "space-app.get").pipe(
          Effect.catchTag("Primitive.Forbidden", () => notFound),
        )
        return yield* AppQueries.relationship(transaction, found.app, found.app.owner_space_id)
      }
      const use = (yield* transaction
        .select()
        .from(Database.Schema.space_app)
        .where(eq(Database.Schema.space_app.id, SpaceApp.ID.make(id)))).at(0)
      if (!use) return yield* notFound
      yield* space(transaction, actor, use.space_id, "space-app.get").pipe(
        Effect.catchTag("Primitive.Forbidden", () => notFound),
      )
      const found = yield* AppQueries.find(transaction, access, actor, use.app_id)
      return yield* AppQueries.relationship(transaction, found.app, use.space_id, use)
    })
    return Service.of({
      list: Effect.fn("SpaceApp.list")(function* (actor, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const allowed = yield* space(transaction, actor, input.spaceId, "space-app.list").pipe(
              Effect.as(true),
              Effect.catchTag(["Primitive.NotFound", "Primitive.Forbidden"], () => Effect.succeed(false)),
            )
            if (!allowed) return Pagination.page([], input)
            const page = Pagination.page(yield* AppQueries.inSpace(transaction, input.spaceId), input)
            const releases = yield* AppQueries.releaseInfos(
              transaction,
              page.items.map((entry) => entry.release),
            )
            const items = yield* Effect.forEach(page.items, (entry) =>
              AppQueries.relationship(
                transaction,
                entry.app,
                input.spaceId,
                entry.use ?? undefined,
                releases.get(entry.release.id),
              ),
            )
            return { ...page, items }
          }),
        )
      }),
      get: Effect.fn("SpaceApp.get")(function* (actor, id) {
        if (!id.startsWith("spa_")) return yield* notFound
        return yield* database.transaction((transaction) => get(transaction, actor, id))
      }),
      create: Effect.fn("SpaceApp.create")(function* (actor, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            yield* space(transaction, actor, input.spaceId, "space-app.create")
            const installed = yield* install(transaction, access, actor, input)
            yield* AppValidation.finalGraph(transaction, {
              organizationId: actor.organizationId,
              spaceIds: [input.spaceId],
            })
            return yield* AppQueries.relationship(transaction, installed.app, input.spaceId, installed.use)
          }),
        )
      }),
      update: Effect.fn("SpaceApp.update")(function* (actor, id, input) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const found = yield* get(transaction, actor, id)
            yield* space(transaction, actor, found.spaceId, "space-app.update")
            if (found.isOwner)
              return yield* new Primitive.Conflict({ message: "An owner relationship cannot be pinned." })
            if (found.archivedAt) return yield* notFound
            const installed = yield* install(
              transaction,
              access,
              actor,
              { spaceId: found.spaceId, appId: found.appId, pinnedReleaseId: input.pinnedReleaseId },
              { isPinUpdate: true },
            )
            yield* AppValidation.finalGraph(transaction, {
              organizationId: actor.organizationId,
              spaceIds: [found.spaceId],
            })
            return yield* AppQueries.relationship(transaction, installed.app, found.spaceId, installed.use)
          }),
        )
      }),
      archive: Effect.fn("SpaceApp.archive")(function* (actor, id) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const found = yield* get(transaction, actor, id)
            yield* space(transaction, actor, found.spaceId, "space-app.archive")
            if (found.isOwner)
              return yield* new Primitive.Conflict({ message: "The owner space cannot remove its app." })
            if (found.archivedAt) return found
            const archived = (yield* transaction
              .update(Database.Schema.space_app)
              .set({ archived_at: sql`now()` })
              .where(eq(Database.Schema.space_app.id, id))
              .returning()).at(0)
            yield* AppValidation.finalGraph(transaction, {
              organizationId: actor.organizationId,
              spaceIds: [found.spaceId],
            })
            if (!archived?.archived_at) return yield* Effect.die(new Error("Archived app use is missing"))
            return { ...found, archivedAt: DateTime.fromDateUnsafe(archived.archived_at) }
          }),
        )
      }),
    })
  }),
)
