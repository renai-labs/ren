import { Schema } from "effect"

const TaskSearchSchema = Schema.Struct({
  view: Schema.optional(Schema.String),
  filters: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
})

export type TaskSearch = typeof TaskSearchSchema.Type

export const TaskSearch = Schema.toStandardSchemaV1(TaskSearchSchema)

export const viewsInput = (spaceId?: string) => ({
  type: "task" as const,
  ...(spaceId && { spaceId }),
  page: 1,
  pageSize: 100,
})
