export * as TaskPolicy from "./policy.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Label } from "@ren/schema/label"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Space } from "@ren/schema/space"
import { Task } from "@ren/schema/task"
import { TaskActivity } from "@ren/schema/task-activity"
import { TaskComment } from "@ren/schema/task-comment"
import { and, eq, isNotNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

const spaceMember = "task.spaceMember"

export const membership = alias(Database.Schema.space_member, "task_membership")

const statements = (actions: ReadonlyArray<string>, options: { readonly agents: boolean }) => [
  { actions, roles: SpacePolicy.administratorRoles, on: Policy.everywhere, agents: options.agents },
  { actions, roles: SpacePolicy.organizationRoles, on: spaceMember, agents: options.agents },
]

export const documents = [
  {
    primitive: Task.definition.name,
    statements: [
      {
        actions: Primitive.actions(Task.definition, ["list"]),
        roles: SpacePolicy.organizationRoles,
        on: Policy.everywhere,
        agents: true,
      },
      ...statements(Primitive.actions(Task.definition, ["get", "create", "update", "assign", "start", "review"]), {
        agents: true,
      }),
      ...statements(Primitive.actions(Task.definition, ["archive"]), { agents: false }),
    ],
  },
  {
    primitive: TaskComment.definition.name,
    statements: [
      ...statements(Primitive.actions(TaskComment.definition, ["create"]), { agents: true }),
      ...statements(Primitive.actions(TaskComment.definition, ["update", "archive"]), { agents: false }),
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
        roles: SpacePolicy.organizationRoles,
        on: Policy.everywhere,
        agents: true,
      },
      {
        actions: Primitive.actions(Label.definition, ["create", "update", "archive"]),
        roles: SpacePolicy.organizationRoles,
        on: Policy.everywhere,
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization: Access.Resource = { relationships: [] }

export const label = (organizationId: Auth.OrganizationID | null): Access.Resource => ({
  relationships: [],
  organizationId,
})

export const resource = (membershipId: Space.MembershipID | null, spaceId: Space.ID): Access.Resource => ({
  relationships: membershipId ? [spaceMember] : [],
  spaceId,
})

export const filter = (plan: Access.Plan) => {
  const inSpace = plan.spaceId ? eq(Database.Schema.task.space_id, plan.spaceId) : undefined
  if (plan.isAllowedEverywhere) return inSpace
  return and(inSpace, plan.allowedWhere.includes(spaceMember) ? isNotNull(membership.id) : sql`false`)
}
