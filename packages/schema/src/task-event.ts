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
  FieldChanged,
  LabelsChanged,
  LinksChanged,
  ParentChanged,
  Archived,
]).annotate({ identifier: "TaskEvent.Data" })
export type Data = typeof Data.Type

export type Kind = Data["_tag"]

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  taskId: Task.ID,
  data: Data,
  actor: Task.Actor,
  createdAt: Schema.DateTimeUtc,
}).annotate({ identifier: "TaskEvent.Info" })
