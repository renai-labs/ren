export * as HostTasks from "./tasks.js"

import { Task } from "@ren/schema/task"
import { TaskActivity } from "@ren/schema/task-activity"
import { Schema, Struct } from "effect"

export const ListInput = Task.ListInput.mapFields(Struct.omit(["spaceId"])).annotate({
  identifier: "HostTasks.ListInput",
})
export const GetInput = Schema.Struct({
  id: Schema.String,
  ...TaskActivity.ListInput.mapFields(Struct.omit(["taskId"])).fields,
}).annotate({ identifier: "HostTasks.GetInput" })
export const GetResult = Schema.Struct({ task: Task.Info, activity: TaskActivity.definition.list.page }).annotate({
  identifier: "HostTasks.GetResult",
})
export const CreateInput = Task.CreateInput.mapFields((fields) => ({
  ...Struct.omit(fields, ["spaceId", "status"]),
  status: Schema.optional(Schema.Literals(["todo", "in_progress"])),
})).annotate({ identifier: "HostTasks.CreateInput" })
export const UpdateInput = Task.UpdateInput.mapFields((fields) => ({
  ...fields,
  id: Task.ID,
  status: Schema.optional(Schema.Literals(["todo", "in_progress"])),
})).annotate({ identifier: "HostTasks.UpdateInput" })
export const AssignInput = Task.AssignInput.mapFields((fields) => ({
  ...Struct.omit(fields, ["spaceId"]),
  id: Task.ID,
}))
  .check(Task.hasAssignee)
  .annotate({ identifier: "HostTasks.AssignInput" })
export const AssignResult = Schema.Struct({ task: Task.Info, message: Schema.String }).annotate({
  identifier: "HostTasks.AssignResult",
})
export const ReviewInput = Schema.Struct({ id: Task.ID, reason: Task.Reason }).annotate({
  identifier: "HostTasks.ReviewInput",
})

export const descriptions = {
  task_list: "List tasks in this session’s space. By default, only todo and in-progress tasks are returned.",
  task_get: "Read a task by ID or identifier and a page of its trail, oldest first.",
  task_create:
    "Create a task in this session’s space. Creating never starts an agent. Do not create a second task for the same work.",
  task_update:
    "Update a task’s content, labels or links. Only a person can mark it done or dismissed. Use task_assign for assignment.",
  task_assign:
    "Hand a task to another agent in this space. The description stays; note is the receiving agent’s instruction. By default, changing the agent starts it.",
  task_review:
    "Ask a person to review completed work, with a reason, then end your turn. Only a person can decide the review.",
  task_comment: "Add a Markdown comment to a task.",
  label_list: "List the organization’s task labels.",
}
