export * as SessionTasks from "./session-tasks.js"

import type { SessionMessage } from "@ren/schema/session-message"
import { Option, Schema } from "effect"
import { ToolState } from "./tool-state.js"

export const statuses = ["pending", "in_progress", "completed", "cancelled"] as const

export type Status = (typeof statuses)[number]

export interface Task {
  readonly id: string
  readonly content: string
  readonly status: Status
}

const decodeTodo = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.optionalKey(Schema.String),
    content: Schema.String,
    status: Schema.Literals(statuses),
  }),
)

export const latest = (messages: ReadonlyArray<SessionMessage.Info>): ReadonlyArray<Task> => {
  const todos = messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .findLast(
      (content): content is SessionMessage.Tool =>
        content.type === "tool" &&
        content.name === "todowrite" &&
        (content.state.status === "running" || content.state.status === "completed") &&
        Array.isArray(ToolState.input(content).todos),
    )
  const items: ReadonlyArray<unknown> = todos ? [ToolState.input(todos).todos].flat() : []
  return items.flatMap((item, index) =>
    Option.match(decodeTodo(item), {
      onNone: () => [],
      onSome: (todo) => [{ id: todo.id ?? String(index), content: todo.content, status: todo.status }],
    }),
  )
}

export const unfinished = (tasks: ReadonlyArray<Task>) =>
  tasks.some((task) => task.status === "pending" || task.status === "in_progress")
