export * as AgentQueries from "./queries.js"

import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { and, eq, isNull, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { SpacePolicy } from "../space/policy.js"
import { SpaceQueries } from "../space/queries.js"

export const isOwnerMember = (actor: Actor.Info) =>
  sql<boolean>`exists (
    select 1 from ${Database.Schema.space_member}
    where ${Database.Schema.space_member.space_id} = ${Database.Schema.agent.owner_space_id}
      and ${Database.Schema.space_member.user_id} = ${actor.userId}
      and ${Database.Schema.space_member.archived_at} is null
  )`

export const isSpaceMember = (actor: Actor.Info) =>
  sql<boolean>`(${isOwnerMember(actor)} or exists (
    select 1 from ${Database.Schema.agent_membership}
    inner join ${Database.Schema.space_member}
      on ${Database.Schema.space_member.space_id} = ${Database.Schema.agent_membership.space_id}
    where ${Database.Schema.agent_membership.agent_id} = ${Database.Schema.agent.id}
      and ${Database.Schema.space_member.user_id} = ${actor.userId}
      and ${Database.Schema.space_member.archived_at} is null
  ))`

export const isInSpace = (spaceId: Space.ID) =>
  or(
    eq(Database.Schema.agent.owner_space_id, spaceId),
    sql`exists (
      select 1 from ${Database.Schema.agent_membership}
      where ${Database.Schema.agent_membership.agent_id} = ${Database.Schema.agent.id}
        and ${Database.Schema.agent_membership.space_id} = ${spaceId}
    )`,
  )

export const select = (transaction: Database.Transaction, actor: Actor.Info) =>
  transaction
    .select({ agent: Database.Schema.agent, isOwnerMember: isOwnerMember(actor), isSpaceMember: isSpaceMember(actor) })
    .from(Database.Schema.agent)

export const isMember = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  actor: Actor.Info,
  spaceId: Space.ID,
) {
  const rows = yield* transaction
    .select({ id: Database.Schema.space_member.id })
    .from(Database.Schema.space_member)
    .where(
      and(
        eq(Database.Schema.space_member.space_id, spaceId),
        eq(Database.Schema.space_member.user_id, actor.userId),
        isNull(Database.Schema.space_member.archived_at),
      ),
    )
  return rows.length > 0
})

const getSpace = Primitive.action(Space.definition, "get")

export const visibleSpace = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  access: Access.Interface,
  actor: Actor.Info,
  spaceId: Space.ID,
) {
  const row = (yield* transaction
    .select({ membershipId: SpaceQueries.membership.id })
    .from(Database.Schema.space)
    .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
    .where(
      and(
        eq(Database.Schema.space.id, spaceId),
        eq(Database.Schema.space.organization_id, actor.organizationId),
        isNull(Database.Schema.space.archived_at),
      ),
    )
    .for("share", { of: Database.Schema.space })).at(0)
  if (!row || !access.isAllowed({ actor, action: getSpace, resource: SpacePolicy.resource(row.membershipId) }))
    return yield* new Primitive.NotFound({ message: "Space not found." })
  return { isMember: Boolean(row.membershipId) }
})
