export * as TaskPolicy from "./policy.js"

import { Database } from "@ren/db/database"
import { Label } from "@ren/schema/label"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { Task } from "@ren/schema/task"
import { TaskActivity } from "@ren/schema/task-activity"
import { TaskComment } from "@ren/schema/task-comment"
import { isNotNull, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const facts = {
  spaceMember: "task.spaceMember",
  author: "comment.author",
  systemLabel: "label.system",
  orgLabel: "label.org",
  spaceLabel: "label.space",
} as const

export const membership = alias(Database.Schema.space_member, "task_membership")

const every = SpacePolicy.organizationRoles

const labelWrites = Primitive.actions(Label.definition, ["create", "update", "archive"])

// oxlint-disable-next-line ren/no-comments -- access §6 (AC4, AC8, AC10, AC17): tasks are inside their space, for its members; an agent acts as its sender. Org labels are for admins; space labels for the members of their space; a system label has neither fact, so nobody changes it.
export const documents = [
  {
    resource: Task.definition.name,
    rules: [
      { actions: Primitive.actions(Task.definition, ["list"]), effect: "allow", roles: every, when: [] },
      { actions: Primitive.actions(Task.definition), effect: "allow", roles: every, when: [facts.spaceMember] },
    ],
  },
  {
    resource: TaskComment.definition.name,
    rules: [
      {
        actions: Primitive.actions(TaskComment.definition, ["create"]),
        effect: "allow",
        roles: every,
        when: [facts.spaceMember],
      },
      {
        actions: Primitive.actions(TaskComment.definition, ["update", "archive"]),
        effect: "allow",
        roles: every,
        when: [facts.spaceMember, facts.author],
      },
    ],
  },
  {
    resource: TaskActivity.definition.name,
    rules: [
      { actions: Primitive.actions(TaskActivity.definition), effect: "allow", roles: every, when: [facts.spaceMember] },
    ],
  },
  {
    resource: Label.definition.name,
    rules: [
      {
        actions: Primitive.actions(Label.definition, ["list"]),
        effect: "allow",
        roles: every,
        when: [facts.systemLabel],
      },
      { actions: Primitive.actions(Label.definition, ["list"]), effect: "allow", roles: every, when: [facts.orgLabel] },
      {
        actions: Primitive.actions(Label.definition, ["list"]),
        effect: "allow",
        roles: every,
        when: [facts.spaceLabel, facts.spaceMember],
      },
      { actions: labelWrites, effect: "allow", roles: SpacePolicy.administratorRoles, when: [facts.orgLabel] },
      { actions: labelWrites, effect: "allow", roles: every, when: [facts.spaceLabel, facts.spaceMember] },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization: Access.Resource = { facts: [] }

export const resource = (membershipId: string | null): Access.Resource => ({
  facts: membershipId ? [facts.spaceMember] : [],
})

export const comment = (membershipId: string | null, options: { readonly isAuthor: boolean }): Access.Resource => ({
  facts: [...(membershipId ? [facts.spaceMember] : []), ...(options.isAuthor ? [facts.author] : [])],
})

export const label = (row: {
  readonly organizationId: string | null
  readonly spaceId: string | null
  readonly isMember: boolean
}): Access.Resource => {
  if (!row.organizationId) return { facts: [facts.systemLabel] }
  if (!row.spaceId) return { facts: [facts.orgLabel] }
  return { facts: [facts.spaceLabel, ...(row.isMember ? [facts.spaceMember] : [])] }
}

export const where: ReadonlyMap<string, SQL> = new Map([[facts.spaceMember, isNotNull(membership.id)]])
