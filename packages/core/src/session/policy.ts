export * as SessionPolicy from "./policy.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, eq, isNotNull } from "drizzle-orm"
import type { Access } from "../access.js"
import { AccessFilter } from "../access-filter.js"
import type { Actor } from "../actor.js"
import { SpacePolicy } from "../space/policy.js"
import { SpaceQueries } from "../space/queries.js"

export const relationships = {
  spaceMember: "session.spaceMember",
  creator: "session.creator",
} as const

export const actions = {
  list: Primitive.action(Session.definition, "list"),
  get: Primitive.action(Session.definition, "get"),
  create: Primitive.action(Session.definition, "create"),
  archive: Primitive.action(Session.definition, "archive"),
}

const every = SpacePolicy.organizationRoles

const admins = SpacePolicy.administratorRoles

// oxlint-disable-next-line ren/no-comments -- Whoever sees a space reads and starts its chats, and so does an agent in that space. Its creator or an admin archives a chat.
export const documents = [
  {
    primitive: Session.definition.name,
    statements: [
      { actions: [actions.list], roles: every, on: Policy.everywhere, agents: true },
      { actions: [actions.get, actions.create], roles: admins, on: Policy.everywhere, agents: true },
      { actions: [actions.get, actions.create], roles: every, on: relationships.spaceMember, agents: true },
      { actions: [actions.archive], roles: admins, on: Policy.everywhere },
      { actions: [actions.archive], roles: every, on: relationships.creator },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization: Access.Resource = { relationships: [] }

export const resource = (
  holds: { readonly membershipId: Space.MembershipID | null; readonly createdBy?: Auth.UserID },
  actor: Actor.Info,
  spaceId: Space.ID,
): Access.Resource => ({
  relationships: [
    ...(holds.membershipId ? [relationships.spaceMember] : []),
    ...(holds.createdBy === actor.userId ? [relationships.creator] : []),
  ],
  spaceId,
})

// oxlint-disable-next-line ren/no-comments -- On a query that joins the chat's space and SpaceQueries.membership.
export const filter = (actor: Actor.Info, plan: Access.Plan) =>
  and(
    plan.spaceId ? eq(Database.Schema.agent_session.space_id, plan.spaceId) : undefined,
    AccessFilter.where(
      plan,
      new Map([
        [relationships.spaceMember, isNotNull(SpaceQueries.membership.id)],
        [relationships.creator, eq(Database.Schema.agent_session.created_by, actor.userId)],
      ]),
    ),
  )
