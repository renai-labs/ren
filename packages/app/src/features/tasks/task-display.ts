export * as TaskDisplay from "./task-display.js"

import { Schema } from "effect"
import { Preference } from "../../lib/preference.js"

const Display = Schema.Struct({
  layout: Schema.String,
  groupBy: Schema.String,
  orderBy: Schema.String,
  direction: Schema.String,
  showEmpty: Schema.Boolean,
  properties: Schema.Array(Schema.String),
})

export type Display = typeof Display.Type

export const preference = Preference.make("tasks.display.v1", Display, {
  layout: "list",
  groupBy: "status",
  orderBy: "created",
  direction: "desc",
  showEmpty: false,
  properties: ["status", "priority", "assignee", "space", "labels"],
})

export const scoped = (display: Display, spaceId: string | undefined) => {
  const groupBy = spaceId && display.groupBy === "space" ? "status" : display.groupBy
  return {
    groupBy,
    properties: display.properties.filter((property) => property !== "space" || (!spaceId && groupBy !== "space")),
  }
}
