export * as TaskPolicy from "./policy.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Label } from "@ren/schema/label"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Space } from "@ren/schema/space"
import { Task } from "@ren/schema/task"
import { TaskActivity } from "@ren/schema/task-activity"
import { TaskComment } from "@ren/schema/task-comment"
import { and, eq, isNotNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Access } from "../access.js"
import { AccessFilter } from "../access-filter.js"

const spaceMember = "task.spaceMember"

const commentAuthor = "comment.author"

export const membership = alias(Database.Schema.space_member, "task_membership")

const statements = (actions: ReadonlyArray<string>, options: { readonly agents: boolean }) => [
  { actions, roles: Auth.administratorRoles, on: Policy.everywhere, agents: options.agents },
  { actions, roles: Auth.Role.literals, on: spaceMember, agents: options.agents },
]

export const actions = {
  close: `${Task.definition.name}.close`,
  decide: `${Task.definition.name}.decide`,
} as const

// oxlint-disable-next-line ren/no-comments -- Only a person closes a task, decides a review or changes their comment.
export const documents = [
  {
    primitive: Task.definition.name,
    statements: [
      {
        actions: Primitive.actions(Task.definition, ["list"]),
        roles: Auth.Role.literals,
        on: Policy.everywhere,
        agents: true,
      },
      ...statements(Primitive.actions(Task.definition, ["get", "create", "update", "assign", "start", "review"]), {
        agents: true,
      }),
      ...statements([...Primitive.actions(Task.definition, ["archive"]), actions.close, actions.decide], {
        agents: false,
      }),
    ],
  },
  {
    primitive: TaskComment.definition.name,
    statements: [
      ...statements(Primitive.actions(TaskComment.definition, ["create"]), { agents: true }),
      {
        actions: Primitive.actions(TaskComment.definition, ["update", "archive"]),
        roles: Auth.Role.literals,
        on: commentAuthor,
      },
    ],
  },
  {
    primitive: TaskActivity.definition.name,
    statements: statements(Primitive.actions(TaskActivity.definition), { agents: true }),
  },
  {
    primitive: Label.definition.name,
    statements: [
      {
        actions: Primitive.actions(Label.definition, ["list"]),
        roles: Auth.Role.literals,
        on: Policy.everywhere,
        agents: true,
      },
      {
        actions: Primitive.actions(Label.definition, ["create", "update", "archive"]),
        roles: Auth.Role.literals,
        on: Policy.everywhere,
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const comment = (holds: { readonly isAuthor: boolean }, spaceId: Space.ID): Access.Resource => ({
  relationships: holds.isAuthor ? [commentAuthor] : [],
  spaceId,
})

export const label = (organizationId: Auth.OrganizationID | null): Access.Resource => ({
  relationships: [],
  organizationId,
})

export const resource = (membershipId: Space.MembershipID | null, spaceId: Space.ID): Access.Resource => ({
  relationships: membershipId ? [spaceMember] : [],
  spaceId,
})

export const filter = (plan: Access.Plan) =>
  and(
    plan.spaceId ? eq(Database.Schema.task.space_id, plan.spaceId) : undefined,
    AccessFilter.where(plan, new Map([[spaceMember, isNotNull(membership.id)]])),
  )
