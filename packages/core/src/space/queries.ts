export * as SpaceQueries from "./queries.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { and, eq, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import { Actor } from "../actor.js"

export const membership = alias(Database.Schema.space_member, "membership")

export const membershipOf = (actor: Actor.Info) =>
  and(
    eq(membership.space_id, Database.Schema.space.id),
    eq(membership.user_id, actor.userId),
    isNull(membership.archived_at),
  )

export const organizationMember = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  userId: Auth.UserID,
) {
  const rows = yield* transaction
    .select({ role: Database.Schema.member.role })
    .from(Database.Schema.member)
    .where(and(eq(Database.Schema.member.organizationId, organizationId), eq(Database.Schema.member.userId, userId)))
    .for("share")
  return rows.at(0)
})

export const organizationRole = Effect.fnUntraced(function* (transaction: Database.Transaction, actor: Actor.Info) {
  const member = yield* organizationMember(transaction, actor.organizationId, actor.userId)
  return member?.role
})
