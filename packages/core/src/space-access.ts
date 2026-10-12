export * as SpaceAccess from "./space-access.js"

import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { and, eq, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import { Actor } from "./actor.js"
import { SpacePolicy } from "./space-policy.js"

export const membership = alias(Database.Schema.space_member, "membership")

export const membershipOf = (actor: Actor.Info) =>
  and(
    eq(membership.space_id, Database.Schema.space.id),
    eq(membership.user_id, actor.userId),
    isNull(membership.archived_at),
  )

const firstSpace = alias(Database.Schema.space, "first_space")

export const isFirst = sql<boolean>`${Database.Schema.space.id} = (
  select ${firstSpace.id} from ${Database.Schema.space} as ${firstSpace}
  where ${firstSpace.organization_id} = ${Database.Schema.space.organization_id}
  order by ${firstSpace.created_at}, ${firstSpace.id}
  limit 1
)`

export const organizationRole = Effect.fnUntraced(function* (transaction: Database.Transaction, actor: Actor.Info) {
  const rows = yield* transaction
    .select({ role: Database.Schema.member.role })
    .from(Database.Schema.member)
    .where(
      and(
        eq(Database.Schema.member.organizationId, actor.organizationId),
        eq(Database.Schema.member.userId, actor.userId),
      ),
    )
    .for("share")
  return rows.at(0)?.role
})

export const load = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  actor: Actor.Info,
  spaceId: Space.ID,
  lock: "share" | "update",
) {
  const role = yield* organizationRole(transaction, actor)
  if (!role) return
  const rows = yield* transaction
    .select({ archivedAt: Database.Schema.space.archived_at, membershipId: membership.id, isFirst })
    .from(Database.Schema.space)
    .leftJoin(membership, membershipOf(actor))
    .where(and(eq(Database.Schema.space.id, spaceId), eq(Database.Schema.space.organization_id, actor.organizationId)))
    .for(lock, { of: Database.Schema.space })
  const row = rows.at(0)
  if (!row) return
  return {
    archivedAt: row.archivedAt,
    access: { role, membershipId: row.membershipId, isFirst: row.isFirst } satisfies SpacePolicy.Access,
  }
})
