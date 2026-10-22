export * as TaskActivity from "./task-activity.js"

import { Schema } from "effect"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Task } from "./task.js"
import { TaskComment } from "./task-comment.js"
import { TaskEvent } from "./task-event.js"

export const ID = Schema.Union([TaskEvent.ID, TaskComment.ID]).annotate({ identifier: "TaskActivity.ID" })
export type ID = typeof ID.Type

export const Info = Schema.Union([
  Schema.Struct({ id: TaskEvent.ID, type: Schema.Literal("event"), event: TaskEvent.Info }),
  Schema.Struct({ id: TaskComment.ID, type: Schema.Literal("comment"), comment: TaskComment.Info }),
]).annotate({ identifier: "TaskActivity.Info" })
export type Info = typeof Info.Type

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  taskId: Task.ID,
  ...Pagination.fields(50),
}).annotate({
  identifier: "TaskActivity.ListInput",
  description:
    "Events and comments of one task, oldest first, ordered by time and then ID. New activity goes on the last page, so the earlier pages do not move.",
})

const Page = Pagination.Page(Info).annotate({ identifier: "TaskActivity.Page" })

export const definition = Primitive.define({
  name: "task-activity",
  plural: "task-activities",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
})
