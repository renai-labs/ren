export * as Seed from "./seed.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Environment } from "@ren/schema/environment"
import { HandProvider } from "@ren/schema/hand-provider"
import { Space } from "@ren/schema/space"
import { SpaceEnvironment } from "@ren/schema/space-environment"
import { and, eq } from "drizzle-orm"
import { Effect } from "effect"

export const organization = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const id = Auth.OrganizationID.create()
  yield* database.db
    .insert(Database.Schema.organization)
    .values({ id, name: "Northstar", slug: id.toLowerCase(), createdAt: new Date() })
  return id
})

export const user = Effect.fnUntraced(function* (
  input: { readonly name?: string; readonly email?: string; readonly emailVerified?: boolean } = {},
) {
  const database = yield* Database.Service
  const id = Auth.UserID.create()
  const seeded = { id, name: input.name ?? "Ada", email: input.email ?? `${id.toLowerCase()}@example.com` }
  yield* database.db.insert(Database.Schema.user).values({
    ...seeded,
    emailVerified: input.emailVerified ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return seeded
})

export const member = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  userId: Auth.UserID,
  role: string,
) {
  const database = yield* Database.Service
  yield* database.db
    .insert(Database.Schema.member)
    .values({ id: Auth.MemberID.create(), organizationId, userId, role, createdAt: new Date() })
})

export const invitation = Effect.fnUntraced(function* (input: {
  readonly organizationId: Auth.OrganizationID
  readonly inviterId: Auth.UserID
  readonly email?: string
  readonly status?: string
  readonly expiresAt?: Date
}) {
  const database = yield* Database.Service
  const id = Auth.InvitationID.create()
  yield* database.db.insert(Database.Schema.invitation).values({
    id,
    organizationId: input.organizationId,
    inviterId: input.inviterId,
    email: input.email ?? "invitee@example.com",
    role: "member",
    status: input.status ?? "pending",
    expiresAt: input.expiresAt ?? new Date(Date.now() + 60_000),
    createdAt: new Date(),
  })
  return id
})

export const team = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID) {
  const database = yield* Database.Service
  const existing = yield* database.db
    .select({ id: Database.Schema.space.id })
    .from(Database.Schema.space)
    .where(and(eq(Database.Schema.space.organization_id, organizationId), eq(Database.Schema.space.name, "Team")))
  const found = existing.at(0)
  if (found) return found.id
  const id = Space.ID.create()
  yield* database.db.insert(Database.Schema.space).values({ id, organization_id: organizationId, name: "Team" })
  return id
})

export const environment = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  options: { readonly id?: Environment.ID; readonly provider?: string; readonly sessionsPerHand?: number } = {},
) {
  const database = yield* Database.Service
  const id = options.id ?? Environment.ID.create()
  yield* database.db.insert(Database.Schema.environment).values({
    id,
    organization_id: organizationId,
    name: "Sandbox",
    provider: HandProvider.ID.make(options.provider ?? "test"),
    config: { label: "seeded" },
    sessions_per_hand: options.sessionsPerHand ?? 8,
  })
  yield* database.db.insert(Database.Schema.space_environment).values({
    id: SpaceEnvironment.ID.create(),
    space_id: yield* team(organizationId),
    environment_id: id,
  })
  return id
})
