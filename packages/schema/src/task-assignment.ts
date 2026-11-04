export * as TaskAssignment from "./task-assignment.js"

import { Option, Schema } from "effect"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  taskId: Schema.String,
  identifier: Schema.String.annotate({ description: "The task’s identifier, such as `REN-12`." }),
  title: Schema.String,
  brief: Schema.String.annotate({
    description: "What the agent reads after the heading: the description, handoff note, review and factory order.",
  }),
}).annotate({
  identifier: "TaskAssignment.Info",
  description: "The task a message assigns to the chat’s agent.",
})

export const text = (info: Info, note: string) =>
  [
    `<task_assignment task_id=${JSON.stringify(info.taskId)} note=${JSON.stringify(note)}>`,
    [`${info.identifier}: ${info.title}`, info.brief].filter((part) => part.length > 0).join("\n\n"),
    "</task_assignment>",
  ].join("\n")

const assignment =
  /^\s*<task_assignment task_id="([^"]+)"[^>]*>\n([^\n:]+): ([^\n]*)(?:\n\n([\s\S]*?))?\n<\/task_assignment>\s*$/u

export const parse = (message: string): Option.Option<Info> => {
  const match = assignment.exec(message)
  const taskId = match?.at(1)
  const identifier = match?.at(2)
  return taskId && identifier
    ? Option.some({ taskId, identifier, title: match?.at(3) ?? "", brief: match?.at(4) ?? "" })
    : Option.none()
}
