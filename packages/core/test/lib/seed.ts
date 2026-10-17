export * as Seed from "./seed.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
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
