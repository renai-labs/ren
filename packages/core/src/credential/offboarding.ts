export * as CredentialOffboarding from "./offboarding.js"

import { Models } from "@ren/schema/models"
import { Database } from "@ren/db/database"
import type { AppProfile } from "@ren/schema/app-profile"
import type { Auth } from "@ren/schema/auth"
import type { Credential } from "@ren/schema/credential"
import type { Envelope } from "@ren/schema/envelope"
import type { Space } from "@ren/schema/space"
import { and, eq, inArray, or, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import { EgressControl } from "../egress-control.js"
import { McpProvider } from "../mcp-provider.js"

const table = Database.Schema.credential

const brains = Database.Schema.brain

const chats = Database.Schema.agent_session

const profiles = Database.Schema.app_profile

// oxlint-disable-next-line ren/no-comments -- `providers` are the deleted `route` credentials whose session and account at the provider Ren cleans up (§10 rule 9).
export interface Removed {
  readonly labels: ReadonlyArray<string>
  readonly workloads: ReadonlyArray<{ readonly kind: "brain"; readonly id: string }>
  readonly providers: ReadonlyArray<Provided>
}

export interface Provided {
  readonly id: Credential.ID
  readonly organizationId: Auth.OrganizationID
  readonly provider: Credential.Provider
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
    providers: rows.flatMap((row): ReadonlyArray<Provided> =>
      row.provider ? [{ ...row, provider: row.provider }] : [],
    ),
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
  const privates = yield* transaction
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(eq(profiles.organization_id, organizationId), eq(profiles.kind, "private"), eq(profiles.user_id, userId)),
    )
  const removed = yield* remove(
    transaction,
    and(
      eq(table.organization_id, organizationId),
      or(
        and(eq(table.owner, "person"), eq(table.user_id, userId)),
        eq(table.account_user_id, userId),
        privates.length
          ? and(
              eq(table.owner, "profile"),
              inArray(
                table.profile_id,
                privates.map((row) => row.id),
              ),
            )
          : undefined,
      ),
    ),
  )
  if (privates.length)
    yield* transaction.delete(profiles).where(
      inArray(
        profiles.id,
        privates.map((row) => row.id),
      ),
    )
  const workloads = yield* sessionBrains(transaction, {
    userId,
    spaces: eq(brains.organization_id, organizationId),
  })
  return { ...removed, labels: [...removed.labels, Models.personLabel], workloads } satisfies Removed
})

// oxlint-disable-next-line ren/no-comments -- A member who leaves a space can no longer be the person of a model request there; every egress answer for PERSON clears, so the next request with their id is refused at once.
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
    labels: [...removed.labels, Models.personLabel],
    workloads: [
      ...(yield* sessionBrains(transaction, { userId, spaces: eq(brains.space_id, spaceId) })),
      ...(yield* reachBrains(transaction, spaceId, userId)),
    ],
  } satisfies Removed
})

// oxlint-disable-next-line ren/no-comments -- A member who joins or leaves a space changes the reach of that space and of the person's one-member spaces (profiles.md §7 rule 3, §11).
export const reachBrains = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  spaceId: Space.ID,
  userId: Auth.UserID,
) {
  const own = yield* transaction
    .select({ id: Database.Schema.space_member.space_id })
    .from(Database.Schema.space_member)
    .where(eq(Database.Schema.space_member.user_id, userId))
  return yield* spaceBrains(transaction, [...new Set([spaceId, ...own.map((row) => row.id)])])
})

// oxlint-disable-next-line ren/no-comments -- An archived space leaves every access list (profiles.md §11).
export const forSpace = Effect.fnUntraced(function* (transaction: Database.Transaction, spaceId: Space.ID) {
  const removed = yield* remove(transaction, and(eq(table.owner, "space"), eq(table.space_id, spaceId)))
  yield* transaction
    .delete(Database.Schema.app_profile_space)
    .where(eq(Database.Schema.app_profile_space.space_id, spaceId))
  return { ...removed, workloads: yield* spaceBrains(transaction, [spaceId]) } satisfies Removed
})

export const forProfile = Effect.fnUntraced(function* (transaction: Database.Transaction, profileId: AppProfile.ID) {
  const removed = yield* remove(transaction, and(eq(table.owner, "profile"), eq(table.profile_id, profileId)))
  return { ...removed, workloads: [] } satisfies Removed
})

// oxlint-disable-next-line ren/no-comments -- Every brain of the spaces, for a reach change (profiles.md §11): a member joins or leaves, or a space is archived.
export const spaceBrains = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  spaceIds: ReadonlyArray<Space.ID>,
) {
  if (!spaceIds.length) return []
  const rows = yield* transaction
    .select({ id: brains.id })
    .from(brains)
    .where(inArray(brains.space_id, [...spaceIds]))
  return rows.map((row) => ({ kind: "brain" as const, id: row.id }))
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
        provider: provided.provider,
        account: provided.accountId ?? undefined,
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
