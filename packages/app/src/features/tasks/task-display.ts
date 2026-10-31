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
  groupBy: "space",
  orderBy: "created",
  direction: "desc",
  showEmpty: false,
  properties: ["status", "priority", "assignee", "labels"],
})
