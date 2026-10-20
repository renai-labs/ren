import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Space } from "@ren/schema/space"
import type { SpaceEnvironmentTemplate } from "@ren/schema/space-environment-template"
import { defineRelationsPart, isNull } from "drizzle-orm"
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { environment_template } from "./environment.sql.js"
import { space } from "./space.sql.js"

export const spaceEnvironmentTemplateConstraint = "space_environment_template_space_id_template_id_uidx"

export const space_environment_template = pgTable(
  "space_environment_template",
  {
    id: text().$type<SpaceEnvironmentTemplate.ID>().primaryKey(),
    space_id: text()
      .$type<Space.ID>()
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    environment_template_id: text()
      .$type<EnvironmentTemplate.ID>()
      .notNull()
      .references(() => environment_template.id, { onDelete: "cascade" }),
    created_at: timestamp().defaultNow().notNull(),
    archived_at: timestamp(),
  },
  (table) => [
    uniqueIndex(spaceEnvironmentTemplateConstraint)
      .on(table.space_id, table.environment_template_id)
      .where(isNull(table.archived_at)),
    index("space_environment_template_environment_template_id_idx").on(table.environment_template_id),
  ],
)

export const spaceEnvironmentTemplateRelations = defineRelationsPart(
  { space, environment_template, space_environment_template },
  (r) => ({
    space_environment_template: {
      space: r.one.space({ from: r.space_environment_template.space_id, to: r.space.id }),
      environment_template: r.one.environment_template({
        from: r.space_environment_template.environment_template_id,
        to: r.environment_template.id,
      }),
    },
  }),
)
