export * as SessionPolicy from "./policy.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, eq, isNotNull } from "drizzle-orm"
import type { Access } from "../access.js"
import { AccessFilter } from "../access-filter.js"
import type { Actor } from "../actor.js"
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

const every = Auth.Role.literals

const admins = Auth.administratorRoles

// oxlint-disable-next-line ren/no-comments -- Its creator or an admin archives a chat.
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

// oxlint-disable-next-line ren/no-comments -- Needs SpaceQueries.membership joined.
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
