import type { TaskInfo, TaskListInput } from "@ren/client"
import { queryOptions } from "@tanstack/react-query"
import { Schema } from "effect"
import { client, pickerPageSize } from "@/lib/api"

type TaskStatus = TaskInfo["status"]
type TaskPriority = NonNullable<TaskInfo["priority"]>

const taskStatuses = ["todo", "in_progress", "done", "dismissed"] as const satisfies ReadonlyArray<TaskStatus>

const TaskSearchSchema = Schema.Struct({
  filters: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
})

export type TaskSearch = typeof TaskSearchSchema.Type

export const TaskSearch = Schema.toStandardSchemaV1(TaskSearchSchema)

const isStatus = (value: string | undefined): value is TaskStatus =>
  taskStatuses.some((status) => status === value)

const isPriority = (value: string | undefined): value is TaskPriority =>
  value === "high" || value === "medium" || value === "low"

const one = (values: ReadonlyArray<string> | undefined) => (values?.length === 1 ? values.at(0) : undefined)

type TaskFilterInput = Omit<TaskListInput, "page" | "pageSize">

export function taskListInput(search: TaskSearch): TaskFilterInput {
  const filters = search.filters ?? {}
  const status = one(filters.status)
  const priority = one(filters.priority)
  const spaceId = one(filters.space)
  const agentId = one(filters.agent)
  const ownerId = one(filters.owner)
  const label = one(filters.label)
  const open = isStatus(status) && (status === "todo" || status === "in_progress")
  return {
    parentId: "none",
    ...(open ? {} : { includeDone: true }),
    ...(isStatus(status) && { status }),
    ...(isPriority(priority) && { priority }),
    ...(spaceId && { spaceId }),
    ...(agentId && { agentId }),
    ...(ownerId && { ownerId }),
    ...(label && { label }),
  }
}

export const allTasksKey = (input?: TaskFilterInput) =>
  input ? (["task", "all", input] as const) : (["task", "all"] as const)

export const allTasksOptions = (input: TaskFilterInput) =>
  queryOptions({
    queryKey: allTasksKey(input),
    queryFn: async (context) => {
      const items: TaskInfo[] = []
      for (let page = 1; ; page++) {
        const result = await client.task.list({ ...input, page, pageSize: pickerPageSize }, { signal: context.signal })
        items.push(...result.items)
        if (page * result.pageSize >= result.total || result.items.length === 0) return { items, total: result.total }
      }
    },
  })
