export * as Seed from "./seed.js"

import { Database } from "@ren/db/database"
import { Agent } from "@ren/schema/agent"
import { Auth } from "@ren/schema/auth"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { EnvironmentProvider } from "@ren/schema/environment-provider"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { SpaceEnvironmentTemplate } from "@ren/schema/space-environment-template"
import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import { RenSettings } from "../../src/settings/ren.js"

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

export const actor = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, role: string) {
  const seeded = yield* user()
  yield* member(organizationId, seeded.id, role)
  return { userId: seeded.id, organizationId, roles: [role] }
})

export const space = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID) {
  const database = yield* Database.Service
  const id = Space.ID.create()
  yield* database.db.insert(Database.Schema.space).values({ id, organization_id: organizationId, name: "Team" })
  return id
})

export const owner = Effect.fnUntraced(function* () {
  const organizationId = yield* organization()
  const creator = yield* user()
  return { organizationId, spaceId: yield* space(organizationId), createdBy: creator.id }
})

export const ren = Effect.fnUntraced(function* (input: { readonly instructions?: string } = {}) {
  const database = yield* Database.Service
  const settings = { permissions: [], references: [] }
  yield* database.transaction((transaction) =>
    RenSettings.apply(transaction, {
      settings: { ...settings, ...input, model: { endpointId: "stub", modelId: "stub-model" } },
      agents: [
        { name: "ren", description: "Ren", isSubagent: false, settings },
        { name: "general", description: "The general subagent", isSubagent: true, settings },
        { name: "explore", description: "The explore subagent", isSubagent: true, settings },
      ],
    }),
  )
})

export const globalAgent = Effect.fnUntraced(function* (name: string, input: { readonly isSubagent: boolean }) {
  const database = yield* Database.Service
  const id = Agent.ID.create()
  yield* database.db
    .insert(Database.Schema.agent)
    .values({ id, name, description: `The ${name} agent`, is_subagent: input.isSubagent })
  return id
})

export const agent = Effect.fnUntraced(function* (
  owner: { readonly organizationId: Auth.OrganizationID; readonly spaceId: Space.ID },
  name: string,
  input: { readonly isSubagent: boolean },
) {
  const database = yield* Database.Service
  const id = Agent.ID.create()
  yield* database.db.insert(Database.Schema.agent).values({
    id,
    organization_id: owner.organizationId,
    owner_space_id: owner.spaceId,
    name,
    is_subagent: input.isSubagent,
  })
  return id
})

export const session = Effect.fnUntraced(function* (
  owner: {
    readonly organizationId: Auth.OrganizationID
    readonly spaceId: Space.ID
    readonly createdBy: Auth.UserID
  },
  start: Omit<Partial<Session.StartInput>, "initialMessage"> = {},
) {
  const database = yield* Database.Service
  const id = start.sessionId ?? Session.ID.create()
  yield* database.db.insert(Database.Schema.agent_session).values({
    id,
    organization_id: owner.organizationId,
    space_id: owner.spaceId,
    created_by: owner.createdBy,
    root_id: id,
    harness: "opencode",
    start_input: { sessionId: id, harness: "opencode", ...start },
  })
  return id
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

export const environmentTemplate = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  options: {
    readonly id?: EnvironmentTemplate.ID
    readonly provider?: string
    readonly sessionsPerEnvironment?: number
  } = {},
) {
  const database = yield* Database.Service
  const id = options.id ?? EnvironmentTemplate.ID.create()
  yield* database.db.insert(Database.Schema.environment_template).values({
    id,
    organization_id: organizationId,
    name: "Sandbox",
    provider: EnvironmentProvider.ID.make(options.provider ?? "test"),
    config: { label: "seeded" },
    sessions_per_environment: options.sessionsPerEnvironment ?? 8,
  })
  yield* database.db.insert(Database.Schema.space_environment_template).values({
    id: SpaceEnvironmentTemplate.ID.create(),
    space_id: yield* team(organizationId),
    environment_template_id: id,
  })
  return id
})
