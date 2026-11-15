export * as TaskEvent from "./task-event.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Session } from "./session.js"
import { Space } from "./space.js"
import { Task } from "./task.js"

export const ID = Identifier.make("tev", "TaskEvent.ID")
export type ID = typeof ID.Type

export const Created = Schema.TaggedStruct("created", {}).annotate({ identifier: "TaskEvent.Created" })

export const Assigned = Schema.TaggedStruct("assigned", {
  fromAgentId: Schema.NullOr(Agent.ID),
  toAgentId: Schema.NullOr(Agent.ID),
  fromOwnerId: Schema.NullOr(Auth.UserID),
  toOwnerId: Schema.NullOr(Auth.UserID),
  fromSpaceId: Space.ID,
  toSpaceId: Space.ID,
  note: Schema.NullOr(Schema.String),
}).annotate({ identifier: "TaskEvent.Assigned" })

export const Started = Schema.TaggedStruct("started", {
  agentId: Agent.ID,
  sessionId: Session.ID,
  mode: Task.StartMode,
}).annotate({ identifier: "TaskEvent.Started" })

export interface Automation extends Schema.Schema.Type<typeof Automation> {}
export const Automation = Schema.Struct({
  provider: Schema.Literal("github"),
  cause: Schema.Literal("pull_request_merged"),
  url: Schema.String,
}).annotate({
  identifier: "TaskEvent.Automation",
  description: "The outside event that changed the status, with no person or agent acting.",
})

export const StatusChanged = Schema.TaggedStruct("status", {
  from: Task.Status,
  to: Task.Status,
  automation: Schema.optionalKey(Automation),
}).annotate({ identifier: "TaskEvent.StatusChanged" })

export const ReviewRequested = Schema.TaggedStruct("review_requested", {
  reason: Schema.String,
}).annotate({ identifier: "TaskEvent.ReviewRequested" })

export const Reviewed = Schema.TaggedStruct("reviewed", {
  decision: Task.Decision,
  comment: Schema.NullOr(Schema.String),
}).annotate({ identifier: "TaskEvent.Reviewed" })

export const Finished = Schema.TaggedStruct("finished", {
  agentId: Schema.NullOr(Agent.ID),
  note: Schema.NullOr(Schema.String),
}).annotate({
  identifier: "TaskEvent.Finished",
  description: "The factory’s work is done. The task has no agent and waits for a person or a merge.",
})

export const Field = Schema.Literals(["title", "description", "priority", "dueAt"]).annotate({
  identifier: "TaskEvent.Field",
})
export type Field = typeof Field.Type

export const FieldChanged = Schema.TaggedStruct("field", {
  field: Field,
  from: Schema.NullOr(Schema.String),
  to: Schema.NullOr(Schema.String),
}).annotate({ identifier: "TaskEvent.FieldChanged" })

export const LabelsChanged = Schema.TaggedStruct("label", {
  from: Schema.Array(Schema.String),
  to: Schema.Array(Schema.String),
}).annotate({ identifier: "TaskEvent.LabelsChanged", description: "Label names before and after." })

export const LinksChanged = Schema.TaggedStruct("link", {
  added: Schema.Array(Schema.String),
  removed: Schema.Array(Schema.String),
}).annotate({ identifier: "TaskEvent.LinksChanged", description: "Link URLs." })

export const ParentChanged = Schema.TaggedStruct("parent", {
  from: Schema.NullOr(Task.ID),
  to: Schema.NullOr(Task.ID),
}).annotate({ identifier: "TaskEvent.ParentChanged" })

export const Archived = Schema.TaggedStruct("archived", {}).annotate({ identifier: "TaskEvent.Archived" })

export const Data = Schema.Union([
  Created,
  Assigned,
  Started,
  StatusChanged,
  ReviewRequested,
  Reviewed,
  Finished,
  FieldChanged,
  LabelsChanged,
  LinksChanged,
  ParentChanged,
  Archived,
]).annotate({ identifier: "TaskEvent.Data" })
export type Data = typeof Data.Type

export type Kind = Data["_tag"]

type Encoded = typeof Data.Encoded

type Of<Tag extends Kind> = Extract<Encoded, { readonly _tag: Tag }>

export interface Names {
  readonly agent: (agentId: string | null) => string | undefined
  readonly person: (userId: string | null) => string | undefined
  readonly space: (spaceId: string) => string
}

export const actorName = (actor: typeof Task.Actor.Encoded, names: Names) =>
  actor.agentId ? (names.agent(actor.agentId) ?? "Agent") : (names.person(actor.userId) ?? "Ren")

const fields = { title: "title", description: "description", priority: "priority", dueAt: "due date" } as const

const assignment = (data: Of<"assigned">, names: Names) => {
  const moved = data.fromSpaceId === data.toSpaceId ? undefined : `moved it to ${names.space(data.toSpaceId)}`
  const assignee = names.agent(data.toAgentId) ?? names.person(data.toOwnerId)
  const changed = data.fromAgentId !== data.toAgentId || data.fromOwnerId !== data.toOwnerId
  const handoff = Boolean(data.fromAgentId) && Boolean(data.toAgentId)
  const assigned = assignee ? `${handoff ? "handed off to" : "assigned it to"} ${assignee}` : "removed the assignee"
  return [changed ? assigned : undefined, moved].filter(Boolean).join(" and ") || "changed the assignment"
}

const parentChange = (data: Of<"parent">) => {
  if (!data.to) return "made this a task of its own"
  return data.from ? "moved this sub-task to another parent" : "made this a sub-task"
}

const statusChange = (data: Of<"status">) =>
  `${data.automation ? "merged a pull request and " : ""}changed status from ${Task.statusLabels[data.from]} to ${Task.statusLabels[data.to]}`

const started = (data: Of<"started">, names: Names) =>
  `started ${names.agent(data.agentId) ?? "an agent"} in ${data.mode === "new" ? "a new" : "the last"} session`

const reviewed = (data: Of<"reviewed">) => (data.decision === "approved" ? "approved the review" : "requested changes")

const labels = (data: Of<"label">) => `changed labels to ${data.to.join(", ") || "none"}`

const links = (data: Of<"link">) => (data.added.length > 0 ? "added a link" : "removed a link")

const plainText = {
  created: "created the task",
  archived: "archived the task",
  review_requested: "requested a human review",
  finished: "finished the task",
} as const

const isPlain = (data: Encoded): data is Of<keyof typeof plainText> => data._tag in plainText

const detailedText = (data: Exclude<Encoded, Of<keyof typeof plainText>>, names: Names) => {
  switch (data._tag) {
    case "status":
      return statusChange(data)
    case "started":
      return started(data, names)
    case "assigned":
      return assignment(data, names)
    case "reviewed":
      return reviewed(data)
    case "field":
      return `changed the ${fields[data.field]}`
    case "label":
      return labels(data)
    case "link":
      return links(data)
    case "parent":
      return parentChange(data)
  }
}

export const describe = (data: Encoded, names: Names) =>
  isPlain(data) ? plainText[data._tag] : detailedText(data, names)

export const note = (data: Encoded) => {
  if (data._tag === "review_requested") return data.reason
  if (data._tag === "reviewed") return data.comment
  if (data._tag === "assigned") return data.note
  if (data._tag === "finished") return data.note
  return null
}

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  taskId: Task.ID,
  data: Data,
  actor: Task.Actor,
  createdAt: Schema.DateTimeUtc,
}).annotate({ identifier: "TaskEvent.Info" })
