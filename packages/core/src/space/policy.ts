export * as SpacePolicy from "./policy.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { Space } from "@ren/schema/space"
import { SpaceEnvironmentTemplate } from "@ren/schema/space-environment-template"
import { SpaceMember } from "@ren/schema/space-member"
import { and, eq, isNotNull } from "drizzle-orm"
import type { Access } from "../access.js"
import { AccessFilter } from "../access-filter.js"
import { SpaceQueries } from "./queries.js"

export const member = "space.member"

const spaceMember = {
  name: member,
  holds: (membershipId: Space.MembershipID | null) => Boolean(membershipId),
  condition: isNotNull(SpaceQueries.membership.id),
}

export const administratorRoles = ["owner", "admin"] as const satisfies ReadonlyArray<Auth.Role>

const conditions = new Map([spaceMember].map((relationship) => [relationship.name, relationship.condition]))

export const organizationRoles = Auth.Role.literals

const organizationActions = Primitive.actions(Space.definition, ["list", "create"])

const readActions = Primitive.actions(Space.definition, ["get"])

const spaceActions = Primitive.actions(Space.definition, ["update", "archive"])

const memberActions = Primitive.actions(SpaceMember.definition)

const spaceEnvironmentTemplateActions = Primitive.actions(SpaceEnvironmentTemplate.definition)

export const documents = [
  {
    primitive: Space.definition.name,
    statements: [
      { actions: organizationActions, roles: organizationRoles, on: Policy.everywhere },
      { actions: readActions, roles: administratorRoles, on: Policy.everywhere, agents: true },
      { actions: readActions, roles: organizationRoles, on: spaceMember.name, agents: true },
      { actions: spaceActions, roles: administratorRoles, on: Policy.everywhere },
      { actions: spaceActions, roles: organizationRoles, on: spaceMember.name },
    ],
  },
  {
    primitive: SpaceMember.definition.name,
    statements: [
      { actions: memberActions, roles: administratorRoles, on: Policy.everywhere },
      { actions: memberActions, roles: organizationRoles, on: spaceMember.name },
    ],
  },
  {
    primitive: SpaceEnvironmentTemplate.definition.name,
    statements: [
      { actions: spaceEnvironmentTemplateActions, roles: administratorRoles, on: Policy.everywhere },
      { actions: spaceEnvironmentTemplateActions, roles: organizationRoles, on: spaceMember.name },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization: Access.Resource = { relationships: [] }

export const resource = (membershipId: Space.MembershipID | null, spaceId: Space.ID): Access.Resource => ({
  relationships: spaceMember.holds(membershipId) ? [spaceMember.name] : [],
  spaceId,
})

export const filter = (plan: Access.Plan) =>
  and(plan.spaceId ? eq(Database.Schema.space.id, plan.spaceId) : undefined, AccessFilter.where(plan, conditions))
