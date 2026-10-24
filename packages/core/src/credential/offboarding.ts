export * as CredentialOffboarding from "./offboarding.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Credential } from "@ren/schema/credential"
import type { Envelope } from "@ren/schema/envelope"
import type { Space } from "@ren/schema/space"
import { and, eq, or, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import { EgressControl } from "../egress-control.js"
import { McpProvider } from "../mcp-provider.js"

const table = Database.Schema.credential

const brains = Database.Schema.brain

const chats = Database.Schema.agent_session

// oxlint-disable-next-line ren/no-comments -- `providers` are the deleted `route` credentials whose session and account at the provider Ren cleans up (§10 rule 9).
export interface Removed {
  readonly labels: ReadonlyArray<string>
  readonly workloads: ReadonlyArray<{ readonly kind: "brain"; readonly id: string }>
  readonly providers: ReadonlyArray<Provided>
}

export interface Provided {
  readonly id: Credential.ID
  readonly organizationId: Auth.OrganizationID
  readonly accountId: string | null
  readonly value: Envelope.Sealed
}

const remove = Effect.fnUntraced(function* (transaction: Database.Transaction, where: SQL | undefined) {
  const rows = yield* transaction.delete(table).where(where).returning({
    id: table.id,
    organizationId: table.organization_id,
    label: table.label,
    provider: table.provider,
    accountId: table.provider_account_id,
    value: table.value,
  })
  return {
    labels: [...new Set(rows.map((row) => row.label))],
    providers: rows.filter((row) => Boolean(row.provider)).map((row): Provided => row),
  }
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
  const removed = yield* remove(
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
  return { ...removed, workloads } satisfies Removed
})

export const forSpaceMember = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  spaceId: Space.ID,
  userId: Auth.UserID,
) {
  const removed = yield* remove(
    transaction,
    and(eq(table.owner, "space"), eq(table.space_id, spaceId), eq(table.account_user_id, userId)),
  )
  return {
    ...removed,
    workloads: yield* sessionBrains(transaction, { userId, spaces: eq(brains.space_id, spaceId) }),
  } satisfies Removed
})

export const forSpace = Effect.fnUntraced(function* (transaction: Database.Transaction, spaceId: Space.ID) {
  const removed = yield* remove(transaction, and(eq(table.owner, "space"), eq(table.space_id, spaceId)))
  return { ...removed, workloads: [] } satisfies Removed
})

export const forWorkload = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  workload: { readonly kind: "brain" | "hand"; readonly id: string },
) {
  const removed = yield* remove(
    transaction,
    and(eq(table.owner, "workload"), eq(table.workload_kind, workload.kind), eq(table.workload_id, workload.id)),
  )
  return { ...removed, workloads: [workload] }
})

// oxlint-disable-next-line ren/no-comments -- After the delete: clear each egress copy (README §6.4 rule 6), and clean up deleted provider credentials at the provider (§10 rule 9).
export const invalidate = Effect.fnUntraced(function* (removed: Removed) {
  const control = yield* EgressControl.Service
  const cleanup = yield* McpProvider.Cleanup
  yield* Effect.forEach(
    removed.providers,
    (provided) =>
      cleanup.start({
        provider: "composio",
        accountId: provided.accountId ?? undefined,
        sealed: { organizationId: provided.organizationId, credentialId: provided.id, value: provided.value },
      }),
    { discard: true },
  )
  yield* Effect.forEach(removed.labels, (label) => control.invalidate({ label }), { discard: true })
  yield* Effect.forEach(
    removed.workloads,
    (workload) => control.invalidate({ workload: EgressControl.workloadPrefix(workload) }),
    { discard: true },
  )
})
