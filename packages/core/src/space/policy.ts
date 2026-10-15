export * as SpacePolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { Space } from "@ren/schema/space"
import { SpaceMember } from "@ren/schema/space-member"
import { isNotNull, or, sql } from "drizzle-orm"
import type { Access } from "../access.js"
import { SpaceQueries } from "./queries.js"

const spaceMember = {
  name: "space.member",
  holds: (membershipId: Space.MembershipID | null) => Boolean(membershipId),
  condition: isNotNull(SpaceQueries.membership.id),
}

const conditions = new Map([spaceMember].map((relationship) => [relationship.name, relationship.condition]))

const organizationRoles = Auth.Role.literals

const administratorRoles = ["owner", "admin"] as const satisfies ReadonlyArray<Auth.Role>

const organizationActions = Primitive.actions(Space.definition, ["list", "create"])

const spaceActions = Primitive.actions(Space.definition, ["get", "update", "archive"])

const memberActions = Primitive.actions(SpaceMember.definition)

export const documents = [
  {
    primitive: Space.definition.name,
    statements: [
      { actions: organizationActions, roles: organizationRoles, on: Policy.everywhere },
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
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization: Access.Resource = { relationships: [] }

export const resource = (membershipId: Space.MembershipID | null): Access.Resource => ({
  relationships: spaceMember.holds(membershipId) ? [spaceMember.name] : [],
})

export const filter = (plan: Access.Plan) =>
  plan.isAllowedEverywhere
    ? undefined
    : (or(...plan.allowedWhere.map((relationship) => conditions.get(relationship))) ?? sql`false`)
