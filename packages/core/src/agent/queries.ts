export * as AgentQueries from "./queries.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { and, eq, isNull, or, type SQL, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import { Actor } from "../actor.js"
import { AgentPolicy } from "./policy.js"
import { Primitive } from "../primitive.js"
import { SpaceQueries } from "../space/queries.js"

export const isOwnerMember = (actor: Actor.Info) =>
  sql<boolean>`exists (
    select 1 from ${Database.Schema.space_member}
    where ${Database.Schema.space_member.space_id} = ${Database.Schema.agent.owner_space_id}
      and ${Database.Schema.space_member.user_id} = ${actor.userId}
      and ${Database.Schema.space_member.archived_at} is null
      and ${Actor.fenced(actor, Database.Schema.space_member.space_id) ?? sql`true`}
  )`

export const isSpaceMember = (actor: Actor.Info) =>
  sql<boolean>`(${isOwnerMember(actor)} or exists (
    select 1 from ${Database.Schema.agent_membership}
    inner join ${Database.Schema.space_member}
      on ${Database.Schema.space_member.space_id} = ${Database.Schema.agent_membership.space_id}
    where ${Database.Schema.agent_membership.agent_id} = ${Database.Schema.agent.id}
      and ${Database.Schema.space_member.user_id} = ${actor.userId}
      and ${Database.Schema.space_member.archived_at} is null
      and ${Actor.fenced(actor, Database.Schema.space_member.space_id) ?? sql`true`}
  ))`

// oxlint-disable-next-line ren/no-comments -- The SQL of the agent facts that a list can use.
export const where = (actor: Actor.Info): ReadonlyMap<string, SQL> =>
  new Map([
    [AgentPolicy.facts.spaceMember, isSpaceMember(actor)],
    [AgentPolicy.facts.ownerMember, isOwnerMember(actor)],
  ])

export const isInSpace = (spaceId: Space.ID | typeof Database.Schema.space.id) =>
  or(
    eq(Database.Schema.agent.owner_space_id, spaceId),
    sql`exists (
      select 1 from ${Database.Schema.agent_membership}
      where ${Database.Schema.agent_membership.agent_id} = ${Database.Schema.agent.id}
        and ${Database.Schema.agent_membership.space_id} = ${spaceId}
    )`,
  )

export const isUsableIn = (
  spaceId: Space.ID | typeof Database.Schema.space.id,
  organizationId: Auth.OrganizationID | typeof Database.Schema.space.organization_id,
) =>
  and(
    isNull(Database.Schema.agent.archived_at),
    eq(Database.Schema.agent.is_subagent, false),
    or(
      isNull(Database.Schema.agent.organization_id),
      and(eq(Database.Schema.agent.organization_id, organizationId), isInSpace(spaceId)),
    ),
  )

const owned = alias(Database.Schema.agent, "owned_agent")

export const factoryOrder = sql<ReadonlyArray<Agent.ID>>`coalesce(
  (
    select jsonb_agg(${Database.Schema.agent.id} order by ordered.position)
    from jsonb_array_elements_text(${Database.Schema.space.agent_order}) with ordinality as ordered(id, position)
    inner join ${Database.Schema.agent} on ${Database.Schema.agent.id} = ordered.id
    where ${isUsableIn(Database.Schema.space.id, Database.Schema.space.organization_id)}
  ),
  (
    select jsonb_agg(${Database.Schema.agent.id} order by ${Database.Schema.agent.name})
    from ${Database.Schema.agent}
    where ${Database.Schema.agent.organization_id} is null
      and ${Database.Schema.agent.archived_at} is null
      and not ${Database.Schema.agent.is_subagent}
      and not exists (
        select 1 from ${Database.Schema.agent} as ${owned}
        where ${owned.owner_space_id} = ${Database.Schema.space.id}
          and ${owned.archived_at} is null
          and not ${owned.is_subagent}
      )
  ),
  '[]'::jsonb
)`

export const select = (transaction: Database.Transaction, actor: Actor.Info) =>
  transaction
    .select({ agent: Database.Schema.agent, isOwnerMember: isOwnerMember(actor), isSpaceMember: isSpaceMember(actor) })
    .from(Database.Schema.agent)

export const isMember = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  spaceId: Space.ID,
  userId: Auth.UserID,
) {
  const rows = yield* transaction
    .select({ id: Database.Schema.space_member.id })
    .from(Database.Schema.space_member)
    .where(
      and(
        eq(Database.Schema.space_member.space_id, spaceId),
        eq(Database.Schema.space_member.user_id, userId),
        isNull(Database.Schema.space_member.archived_at),
      ),
    )
  return rows.length > 0
})

export const visibleSpace = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
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
  // oxlint-disable-next-line ren/no-comments -- access AC4: what is inside a space is for its members; an admin joins first.
  if (!row?.membershipId) return yield* new Primitive.NotFound({ message: "Space not found." })
  return { isMember: true, membershipId: row.membershipId }
})
