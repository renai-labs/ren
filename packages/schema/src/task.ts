export * as Task from "./task.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Label } from "./label.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Session } from "./session.js"
import { Space } from "./space.js"
import { TaskLink } from "./task-link.js"

export const ID = Identifier.make("tsk", "Task.ID")
export type ID = typeof ID.Type

export const Status = Schema.Literals(["todo", "in_progress", "done", "dismissed"]).annotate({
  identifier: "Task.Status",
  description:
    "The state of the whole task, never of one agent. `todo`: no one started it. `in_progress`: the work started and is not finished; a handoff keeps it. `done`: finished. `dismissed`: no one will do it; it stays readable so that it is not suggested again. Only a person sets `done` or `dismissed`.",
})
export type Status = typeof Status.Type

export const actionable: ReadonlyArray<Status> = ["todo", "in_progress"]

export const Priority = Schema.Literals(["low", "medium", "high"]).annotate({ identifier: "Task.Priority" })
export type Priority = typeof Priority.Type

export const StartMode = Schema.Literals(["new", "continue"]).annotate({
  identifier: "Task.StartMode",
  description:
    "`new` opens a new session for the task’s agent. `continue` resumes the agent’s latest session on this task, or opens one when there is none.",
})
export type StartMode = typeof StartMode.Type

export const SessionState = Schema.Literals(["working", "idle", "failed"]).annotate({
  identifier: "Task.SessionState",
})
export type SessionState = typeof SessionState.Type

export const maximumTitleLength = 256
export const maximumLabels = 16
export const maximumLinks = 32
export const maximumReasonLength = 2000
export const maximumNoteLength = 20_000

export const Title = Schema.Trim.check(
  Schema.isNonEmpty({ message: "Title is required." }),
  Schema.isMaxLength(maximumTitleLength, { message: `Use ${maximumTitleLength} characters or fewer.` }),
).annotate({ identifier: "Task.Title" })

export const LabelName = Label.Name.check(
  Schema.makeFilter(
    (name) => !Label.isReserved(name) || Label.isSystem(name) || "The only ren- labels are ren-improve and ren-fix.",
  ),
).annotate({ identifier: "Task.LabelName" })

const Labels = Schema.Array(LabelName).check(
  Schema.isMaxLength(maximumLabels, { message: `A task has at most ${maximumLabels} labels.` }),
)

const Links = Schema.Array(TaskLink.Url).check(
  Schema.isMaxLength(maximumLinks, { message: `A task has at most ${maximumLinks} links.` }),
)

export const Reason = Schema.Trim.check(
  Schema.isNonEmpty({ message: "Reason is required." }),
  Schema.isMaxLength(maximumReasonLength, { message: `Use ${maximumReasonLength} characters or fewer.` }),
).annotate({ identifier: "Task.Reason" })

const parentDescription =
  "Makes the task a subtask of this task, which must be in the same space and not be a subtask itself."

const Note = Schema.String.check(
  Schema.isMaxLength(maximumNoteLength, { message: `Use ${maximumNoteLength} characters or fewer.` }),
)

export interface Actor extends Schema.Schema.Type<typeof Actor> {}
export const Actor = Schema.Struct({
  userId: Schema.NullOr(Auth.UserID),
  agentId: Schema.NullOr(Agent.ID),
  sessionId: Schema.NullOr(Session.ID),
}).annotate({
  identifier: "Task.Actor",
  description:
    "Who acted: a person, an agent in a session on a person’s behalf, or the system when every field is null.",
})

export interface AgentSession extends Schema.Schema.Type<typeof AgentSession> {}
export const AgentSession = Schema.Struct({
  id: Session.ID,
  state: SessionState,
}).annotate({
  identifier: "Task.AgentSession",
  description: "The latest session of the task’s agent on this task.",
})

export interface Parent extends Schema.Schema.Type<typeof Parent> {}
export const Parent = Schema.Struct({
  id: ID,
  identifier: Schema.String,
  title: Schema.String,
}).annotate({ identifier: "Task.Parent" })

export interface Subtasks extends Schema.Schema.Type<typeof Subtasks> {}
export const Subtasks = Schema.Struct({
  total: Schema.Int,
  done: Schema.Int,
}).annotate({
  identifier: "Task.Subtasks",
  description: "The task’s live subtasks: `done` of `total`. Dismissed subtasks count in neither.",
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  organizationId: Auth.OrganizationID,
  spaceId: Space.ID,
  parentId: Schema.NullOr(ID),
  parent: Schema.NullOr(Parent),
  subtasks: Schema.NullOr(Subtasks).annotate({ description: "Null when the task has no live subtasks." }),
  number: Schema.Int,
  identifier: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  status: Status,
  priority: Schema.NullOr(Priority),
  humanReview: Schema.Boolean,
  humanReviewReason: Schema.NullOr(Schema.String),
  dueAt: Schema.NullOr(Schema.DateTimeUtc),
  agentId: Schema.NullOr(Agent.ID),
  ownerId: Schema.NullOr(Auth.UserID),
  session: Schema.NullOr(AgentSession),
  labels: Schema.Array(Label.Summary),
  links: Schema.Array(TaskLink.Info),
  createdBy: Actor,
  canUpdate: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Task.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID),
  status: Schema.optional(Status).annotate({ description: "Only this status. Wins over `includeDone`." }),
  includeDone: Schema.optional(Schema.Boolean).annotate({
    description: "Include `done` and `dismissed` tasks. Without it, a list has only the actionable tasks.",
  }),
  priority: Schema.optional(Priority),
  agentId: Schema.optional(Agent.ID),
  ownerId: Schema.optional(Auth.UserID),
  label: Schema.optional(Label.Name).annotate({ description: "A label name, in any case." }),
  humanReview: Schema.optional(Schema.Boolean),
  linkedTo: Schema.optional(TaskLink.Url).annotate({
    description:
      "Only tasks that link this URL. A pull request, Linear issue or Slack thread matches however its URL is written.",
  }),
  parentId: Schema.optional(Schema.Union([ID, Schema.Literal("none")])).annotate({
    description: "A task ID: only its subtasks, oldest first. `none`: only tasks that are not subtasks.",
  }),
  ...Pagination.fields(50),
}).annotate({ identifier: "Task.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Task.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  spaceId: Space.ID,
  title: Title,
  description: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  priority: Schema.optional(Priority),
  labels: Schema.optional(Labels),
  links: Schema.optional(Links),
  dueAt: Schema.optional(Schema.DateTimeUtc),
  agentId: Schema.optional(Agent.ID).annotate({
    description: "The agent that has the task. Creating never starts it.",
  }),
  ownerId: Schema.optional(Auth.UserID).annotate({ description: "The person responsible for the task." }),
  parentId: Schema.optional(ID).annotate({ description: parentDescription }),
}).annotate({ identifier: "Task.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  title: Schema.optional(Title),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Status),
  priority: Schema.optional(Schema.NullOr(Priority)),
  labels: Schema.optional(Labels).annotate({ description: "Replaces the task’s labels." }),
  dueAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  addLinks: Schema.optional(Links),
  removeLinks: Schema.optional(Schema.Array(Schema.Union([TaskLink.ID, TaskLink.Url]))).annotate({
    description: "Links to remove, by ID or by URL.",
  }),
  parentId: Schema.optional(Schema.NullOr(ID)).annotate({
    description: `${parentDescription} Null makes it a task of its own. A task that has subtasks cannot become one.`,
  }),
}).annotate({
  identifier: "Task.UpdateInput",
  description: "Change the task’s content. Assignment has its own action, `assign`.",
})

export const hasAssignee = Schema.makeFilter(
  (input: object) => "agentId" in input || "ownerId" in input || "Pass agentId or ownerId.",
)

export interface AssignInput extends Schema.Schema.Type<typeof AssignInput> {}
export const AssignInput = Schema.Struct({
  agentId: Schema.optional(Schema.NullOr(Agent.ID)).annotate({
    description:
      "The new agent, or null for none. An agent whose start message lists handoff choices can hand off only to those agents.",
  }),
  ownerId: Schema.optional(Schema.NullOr(Auth.UserID)).annotate({ description: "The new owner, or null for none." }),
  spaceId: Schema.optional(Space.ID).annotate({
    description:
      "Moves the task and its subtasks to this space. An owner who is not a member of the space is cleared, and so is a subtask’s agent that the space cannot use. A subtask moves only with its parent.",
  }),
  note: Schema.optional(Note).annotate({
    description: "The instruction for the receiving agent. The trail keeps it; the description stays.",
  }),
  start: Schema.optional(Schema.Literals(["new", "continue", "none"])).annotate({
    description: "Whether to start the agent. The default is `continue` when the agent changes, else `none`.",
  }),
})
  .check(hasAssignee)
  .annotate({ identifier: "Task.AssignInput" })

export interface StartInput extends Schema.Schema.Type<typeof StartInput> {}
export const StartInput = Schema.Struct({ mode: StartMode }).annotate({ identifier: "Task.StartInput" })

export const Decision = Schema.Literals(["approved", "changes_requested"]).annotate({ identifier: "Task.Decision" })
export type Decision = typeof Decision.Type

export const ReviewInput = Schema.Union([
  Schema.Struct({
    humanReview: Schema.Literal(true),
    reason: Reason.annotate({ description: "Why a person must act, and what to look at." }),
  }),
  Schema.Struct({
    humanReview: Schema.Literal(false),
    decision: Decision,
    comment: Schema.optional(Note),
    start: Schema.optional(Schema.Literals(["continue", "none"])).annotate({
      description:
        "Whether to continue the agent’s latest session with the decision. Without it, Ren’s default applies.",
    }),
  }).check(
    Schema.makeFilter(
      (input) => input.decision === "approved" || Boolean(input.comment?.trim()) || "Say what to change.",
    ),
  ),
]).annotate({
  identifier: "Task.ReviewInput",
  description:
    "Turn human review on, with the reason a person must act, or off, with a person’s decision. Only a person turns it off.",
})
export type ReviewInput = typeof ReviewInput.Type

export const definition = Primitive.define({
  name: "task",
  plural: "tasks",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
  actions: {
    assign: { input: AssignInput, result: Info },
    start: { input: StartInput, result: Info },
    review: { input: ReviewInput, result: Info },
  },
})
