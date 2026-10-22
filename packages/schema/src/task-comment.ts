export * as TaskComment from "./task-comment.js"

import { Schema } from "effect"
import { Identifier } from "./identifier.js"
import { Primitive } from "./primitive.js"
import { Task } from "./task.js"

export const ID = Identifier.make("tcm", "TaskComment.ID")
export type ID = typeof ID.Type

export const maximumBodyLength = 20_000

export const Body = Schema.String.check(
  Schema.makeFilter((body) => body.trim() !== "" || "Comment is required."),
  Schema.isMaxLength(maximumBodyLength, { message: `Use ${maximumBodyLength} characters or fewer.` }),
).annotate({ identifier: "TaskComment.Body", description: "Markdown." })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  taskId: Task.ID,
  body: Schema.String,
  author: Task.Actor,
  editedAt: Schema.NullOr(Schema.DateTimeUtc),
  canUpdate: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "TaskComment.Info" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({ taskId: Task.ID, body: Body }).annotate({
  identifier: "TaskComment.CreateInput",
})

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({ body: Body }).annotate({ identifier: "TaskComment.UpdateInput" })

export const definition = Primitive.define({
  name: "task-comment",
  plural: "task-comments",
  id: ID,
  info: Info,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
})
