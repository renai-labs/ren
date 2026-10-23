import type { App } from "@ren/schema/app"
import type { AppRelease } from "@ren/schema/app-release"
import type { Space } from "@ren/schema/space"
import type { SpaceApp } from "@ren/schema/space-app"
import { defineRelationsPart, isNull } from "drizzle-orm"
import { foreignKey, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { app, app_release } from "./app.sql.js"
import { space } from "./space.sql.js"

export const spaceAppConstraint = "space_app_space_id_app_id_uidx"
export const space_app = pgTable(
  "space_app",
  {
    id: text().$type<SpaceApp.ID>().primaryKey(),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id),
    app_id: text()
      .$type<App.ID>()
      .notNull()
      .references(() => app.id),
    pinned_release_id: text().$type<AppRelease.ID>(),
    created_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(spaceAppConstraint).on(table.space_id, table.app_id).where(isNull(table.archived_at)),
    index("space_app_app_id_idx").on(table.app_id),
    foreignKey({
      name: "space_app_pin_fk",
      columns: [table.app_id, table.pinned_release_id],
      foreignColumns: [app_release.app_id, app_release.id],
    }),
  ],
)

export const spaceAppRelations = defineRelationsPart({ space_app, app, space }, (r) => ({
  space_app: {
    space: r.one.space({ from: r.space_app.space_id, to: r.space.id }),
    app: r.one.app({ from: r.space_app.app_id, to: r.app.id }),
  },
}))
