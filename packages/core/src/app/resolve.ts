export * as AppResolve from "./resolve.js"

import { Database } from "@ren/db/database"
import type { App } from "@ren/schema/app"
import type { AppCatalog } from "@ren/schema/app-catalog"
import type { AppRelease } from "@ren/schema/app-release"
import type { Space } from "@ren/schema/space"
import { and, eq, isNull, or, sql } from "drizzle-orm"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Context, Effect, Layer } from "effect"
import { Primitive } from "../primitive.js"
import { AppQueries } from "./queries.js"

export interface Interface {
  readonly revision: (spaceId: Space.ID) => Effect.Effect<string, Primitive.NotFound | EffectDrizzleQueryError>
  readonly forSpace: (spaceId: Space.ID) => Effect.Effect<AppCatalog.Info, Primitive.NotFound | EffectDrizzleQueryError>
}
export class Service extends Context.Service<Service, Interface>()("@ren/core/AppResolve") {}

// oxlint-disable-next-line ren/no-comments -- Releases are immutable, so the selected release of each app names the whole catalog.
const fingerprint = (selected: ReadonlyArray<{ readonly appId: App.ID; readonly releaseId: AppRelease.ID }>) =>
  new Bun.CryptoHasher("sha256")
    .update(
      selected
        .map((entry) => `${entry.appId}:${entry.releaseId}`)
        .toSorted()
        .join("\n"),
    )
    .digest("hex")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const active = Effect.fnUntraced(function* (spaceId: Space.ID) {
      const space = (yield* database.db
        .select({ id: Database.Schema.space.id })
        .from(Database.Schema.space)
        .where(and(eq(Database.Schema.space.id, spaceId), isNull(Database.Schema.space.archived_at)))).at(0)
      if (!space) return yield* new Primitive.NotFound({ message: "Space not found." })
    })
    return Service.of({
      revision: Effect.fn("AppResolve.revision")(function* (spaceId) {
        yield* active(spaceId)
        return fingerprint(
          yield* database.db
            .select({
              appId: Database.Schema.app.id,
              releaseId: sql<AppRelease.ID>`coalesce(${Database.Schema.space_app.pinned_release_id}, ${Database.Schema.app.latest_release_id})`,
            })
            .from(Database.Schema.app)
            .leftJoin(
              Database.Schema.space_app,
              and(
                eq(Database.Schema.space_app.app_id, Database.Schema.app.id),
                eq(Database.Schema.space_app.space_id, spaceId),
                isNull(Database.Schema.space_app.archived_at),
              ),
            )
            .where(
              and(
                isNull(Database.Schema.app.archived_at),
                or(eq(Database.Schema.app.owner_space_id, spaceId), sql`${Database.Schema.space_app.id} is not null`),
              ),
            ),
        )
      }),
      forSpace: Effect.fn("AppResolve.forSpace")(function* (spaceId) {
        yield* active(spaceId)
        const entries = (yield* AppQueries.inSpace(database.db, spaceId)).map((entry) => ({
          app: entry.app,
          release: entry.release,
          provenance: {
            appId: entry.app.id,
            releaseId: entry.release.id,
            appSlug: entry.app.slug,
            version: entry.release.version,
          },
        }))
        const catalog: AppCatalog.Catalog = {
          apps: entries.map((entry) => entry.provenance),
          skills: entries.flatMap((entry) =>
            Object.entries(entry.release.skills)
              .toSorted(([a], [b]) => a.localeCompare(b))
              .map(([slug, declaration]) => ({
                appId: entry.provenance.appId,
                releaseId: entry.provenance.releaseId,
                appSlug: entry.provenance.appSlug,
                version: entry.provenance.version,
                slug,
                declaration,
              })),
          ),
          mcps: entries.flatMap((entry) =>
            Object.entries(entry.release.mcps)
              .toSorted(([a], [b]) => a.localeCompare(b))
              .map(([slug, declaration]) => ({
                appId: entry.provenance.appId,
                releaseId: entry.provenance.releaseId,
                appSlug: entry.provenance.appSlug,
                version: entry.provenance.version,
                slug,
                declaration,
              })),
          ),
          credentials: entries.map((entry) => ({
            appId: entry.app.id,
            requirements: entry.release.required_credentials,
          })),
        }
        return { fingerprint: fingerprint(entries.map((entry) => entry.provenance)), catalog }
      }),
    })
  }),
)
