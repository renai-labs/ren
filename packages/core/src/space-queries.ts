export * as SpaceQueries from "./space-queries.js"

import { Database } from "@ren/db/database"
import { and, eq, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import { Actor } from "./actor.js"

export const membership = alias(Database.Schema.space_member, "membership")

export const membershipOf = (actor: Actor.Info) =>
  and(
    eq(membership.space_id, Database.Schema.space.id),
    eq(membership.user_id, actor.userId),
    isNull(membership.archived_at),
  )

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
