export * as CredentialOffboarding from "./offboarding.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { and, eq, or, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import { EgressControl } from "../egress-control.js"

const table = Database.Schema.credential

const brains = Database.Schema.brain

const chats = Database.Schema.agent_session

export interface Removed {
  readonly labels: ReadonlyArray<string>
  readonly workloads: ReadonlyArray<{ readonly kind: "brain"; readonly id: string }>
}

const remove = Effect.fnUntraced(function* (transaction: Database.Transaction, where: SQL | undefined) {
  const rows = yield* transaction.delete(table).where(where).returning({ label: table.label })
  return [...new Set(rows.map((row) => row.label))]
})

// oxlint-disable-next-line ren/no-comments -- The session-scope brains of a person in a space. A37: space and person credentials stop resolving there once the person leaves the space, so their cached answers go too.
const sessionBrains = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  where: { readonly userId: Auth.UserID; readonly spaces: SQL | undefined },
) {
  const rows = yield* transaction
    .selectDistinct({ id: brains.id })
    .from(brains)
    .innerJoin(chats, eq(chats.brain_id, brains.id))
    .where(and(eq(brains.scope, "session"), eq(chats.created_by, where.userId), where.spaces))
  return rows.map((row) => ({ kind: "brain" as const, id: row.id }))
})

export const forMember = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  userId: Auth.UserID,
) {
  const labels = yield* remove(
    transaction,
    and(
      eq(table.organization_id, organizationId),
      or(and(eq(table.owner, "person"), eq(table.user_id, userId)), eq(table.account_user_id, userId)),
    ),
  )
  const workloads = yield* sessionBrains(transaction, {
    userId,
    spaces: eq(brains.organization_id, organizationId),
  })
  return { labels, workloads } satisfies Removed
})

export const forSpaceMember = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  spaceId: Space.ID,
  userId: Auth.UserID,
) {
  const labels = yield* remove(
    transaction,
    and(eq(table.owner, "space"), eq(table.space_id, spaceId), eq(table.account_user_id, userId)),
  )
  return {
    labels,
    workloads: yield* sessionBrains(transaction, { userId, spaces: eq(brains.space_id, spaceId) }),
  } satisfies Removed
})

export const forSpace = Effect.fnUntraced(function* (transaction: Database.Transaction, spaceId: Space.ID) {
  const labels = yield* remove(transaction, and(eq(table.owner, "space"), eq(table.space_id, spaceId)))
  return { labels, workloads: [] } satisfies Removed
})

export const forWorkload = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  workload: { readonly kind: "brain" | "hand"; readonly id: string },
) {
  const labels = yield* remove(
    transaction,
    and(eq(table.owner, "workload"), eq(table.workload_kind, workload.kind), eq(table.workload_id, workload.id)),
  )
  return { labels, workloads: [workload] }
})

export const invalidate = Effect.fnUntraced(function* (removed: Removed) {
  const control = yield* EgressControl.Service
  yield* Effect.forEach(removed.labels, (label) => control.invalidate({ label }), { discard: true })
  yield* Effect.forEach(
    removed.workloads,
    (workload) => control.invalidate({ workload: EgressControl.workloadPrefix(workload) }),
    { discard: true },
  )
})
