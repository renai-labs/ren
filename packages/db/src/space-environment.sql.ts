import type { Environment } from "@ren/schema/environment"
import type { Space } from "@ren/schema/space"
import type { SpaceEnvironment } from "@ren/schema/space-environment"
import { defineRelationsPart, isNull } from "drizzle-orm"
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { environment } from "./environment.sql.js"
import { space } from "./space.sql.js"

export const spaceEnvironmentConstraint = "space_environment_space_id_environment_id_uidx"

export const space_environment = pgTable(
  "space_environment",
  {
    id: text().$type<SpaceEnvironment.ID>().primaryKey(),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    environment_id: text()
      .$type<Environment.ID>()
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    created_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(spaceEnvironmentConstraint).on(table.space_id, table.environment_id).where(isNull(table.archived_at)),
    index("space_environment_environment_id_idx").on(table.environment_id),
  ],
)

export const spaceEnvironmentRelations = defineRelationsPart({ space, environment, space_environment }, (r) => ({
  space_environment: {
    space: r.one.space({ from: r.space_environment.space_id, to: r.space.id }),
    environment: r.one.environment({ from: r.space_environment.environment_id, to: r.environment.id }),
  },
}))
