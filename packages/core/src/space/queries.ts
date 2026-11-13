export * as SpaceQueries from "./queries.js"

import type { MachineProvider } from "../machine-provider.js"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { and, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect, Equal } from "effect"
import type { Access } from "../access.js"
import { Actor } from "../actor.js"
import { SessionPolicy } from "../session/policy.js"
import { SpacePolicy } from "./policy.js"

export const membership = alias(Database.Schema.space_member, "membership")

export const membershipOf = (actor: Actor.Info) =>
  and(
    eq(membership.space_id, Database.Schema.space.id),
    eq(membership.user_id, actor.userId),
    isNull(membership.archived_at),
    Actor.fenced(actor, membership.space_id),
  )

// oxlint-disable-next-line ren/no-comments -- The SQL of the space and session facts.
export const where: ReadonlyMap<string, SQL> = new Map([
  [SpacePolicy.facts.member, isNotNull(membership.id)],
  [SpacePolicy.facts.shared, eq(Database.Schema.space.kind, "shared")],
  [SpacePolicy.facts.private, eq(Database.Schema.space.kind, "private")],
  [SessionPolicy.facts.spaceMember, isNotNull(membership.id)],
])

export const hand = (
  row: Pick<typeof Database.Schema.space.$inferSelect, "hand_placement" | "environment_template_id">,
): Space.Hand => {
  if (row.hand_placement === "none") return { placement: "none" }
  if (row.hand_placement === "remote" && row.environment_template_id)
    return { placement: "remote", environmentTemplateId: row.environment_template_id }
  return { placement: "colocated" }
}

export const handColumns = (hand: Space.Hand) => ({
  hand_placement: hand.placement,
  environment_template_id: hand.placement === "remote" ? hand.environmentTemplateId : null,
})

export const brainMachine = (
  row: Pick<typeof Database.Schema.space.$inferSelect, "brain_provider" | "brain_template_id">,
  deploymentProvider: MachineProvider.ID | null,
): Space.BrainMachine => ({
  provider: row.brain_provider ?? deploymentProvider,
  environmentTemplateId: row.brain_template_id,
})

export const machines = (
  row: Pick<
    typeof Database.Schema.space.$inferSelect,
    "brain_provider" | "brain_template_id" | "hand_placement" | "environment_template_id"
  >,
  deploymentProvider: MachineProvider.ID | null,
) => ({ brain: brainMachine(row, deploymentProvider), hand: hand(row) })

export const brainColumns = (brain: Space.BrainMachine) => ({
  brain_provider: brain.provider,
  brain_template_id: brain.environmentTemplateId,
})

// oxlint-disable-next-line ren/no-comments -- Whether an update changes the space's brain or hand. Each such change takes the next compute_revision: each brain applies it at its next start or wake, and shows it as pending until then.
export const isComputeChanged = (
  current: ReturnType<typeof machines>,
  input: Pick<Space.UpdateInput, "brain" | "hand">,
) =>
  !Equal.equals(
    [brainColumns(input.brain ?? current.brain), handColumns(input.hand ?? current.hand)],
    [brainColumns(current.brain), handColumns(current.hand)],
  )

export const slugs = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
) {
  yield* transaction
    .select({ id: Database.Schema.organization.id })
    .from(Database.Schema.organization)
    .where(eq(Database.Schema.organization.id, organizationId))
    .for("no key update")
  const rows = yield* transaction
    .select({ slug: Database.Schema.space.slug })
    .from(Database.Schema.space)
    .where(and(eq(Database.Schema.space.organization_id, organizationId), isNull(Database.Schema.space.archived_at)))
  return new Set(rows.map((row) => row.slug))
})

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

// oxlint-disable-next-line ren/no-comments -- access AC12: a private space's archive takes its agents and apps.
export const archiveOwned = Effect.fnUntraced(function* (transaction: Database.Transaction, spaceId: Space.ID) {
  const agents = transaction
    .select({ id: Database.Schema.agent.id })
    .from(Database.Schema.agent)
    .where(and(eq(Database.Schema.agent.owner_space_id, spaceId), isNull(Database.Schema.agent.archived_at)))
  yield* transaction
    .delete(Database.Schema.agent_membership)
    .where(inArray(Database.Schema.agent_membership.agent_id, agents))
  yield* transaction
    .update(Database.Schema.agent)
    .set({ archived_at: sql`now()`, updated_at: sql`now()` })
    .where(and(eq(Database.Schema.agent.owner_space_id, spaceId), isNull(Database.Schema.agent.archived_at)))
  yield* transaction
    .update(Database.Schema.app)
    .set({ archived_at: sql`now()`, updated_at: sql`now()` })
    .where(and(eq(Database.Schema.app.owner_space_id, spaceId), isNull(Database.Schema.app.archived_at)))
})

// oxlint-disable-next-line ren/no-comments -- Whether a person may send a turn in a space (access §13).
export const actsIn = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  access: Access.Interface,
  organizationId: Auth.OrganizationID,
  spaceId: Space.ID,
  userId: Auth.UserID,
) {
  const rows = yield* transaction
    .select({ role: Database.Schema.member.role, membershipId: Database.Schema.space_member.id })
    .from(Database.Schema.member)
    .leftJoin(
      Database.Schema.space_member,
      and(
        eq(Database.Schema.space_member.space_id, spaceId),
        eq(Database.Schema.space_member.user_id, userId),
        isNull(Database.Schema.space_member.archived_at),
      ),
    )
    .where(and(eq(Database.Schema.member.organizationId, organizationId), eq(Database.Schema.member.userId, userId)))
  return rows.some((row) =>
    access.isAllowed({
      actor: { userId, organizationId, roles: Auth.roles(row.role) },
      action: SessionPolicy.actions.send,
      resource: SessionPolicy.resource(row.membershipId),
    }),
  )
})

// oxlint-disable-next-line ren/no-comments -- Cancels the pending requests that match `where`. Used when a request is moot: the person joined another way, the space was archived, or the person left the organization.
export const cancelJoinRequests = (transaction: Database.Transaction, where: SQL | undefined) =>
  transaction
    .update(Database.Schema.space_join_request)
    .set({ status: "cancelled", decided_at: sql`now()` })
    .where(and(eq(Database.Schema.space_join_request.status, "pending"), where))
