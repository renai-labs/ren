import { Schema } from "effect"

const TaskSearchSchema = Schema.Struct({
  filters: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
})

export type TaskSearch = typeof TaskSearchSchema.Type

export const TaskSearch = Schema.toStandardSchemaV1(TaskSearchSchema)
