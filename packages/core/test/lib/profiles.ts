export * as ProfilesFixture from "./profiles.js"

import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { AppProfile } from "@ren/schema/app-profile"
import { Brain } from "@ren/schema/brain"
import type { Auth } from "@ren/schema/auth"
import { Credential } from "@ren/schema/credential"
import type { Mcp } from "@ren/schema/mcp"
import type { Space as SpaceSchema } from "@ren/schema/space"
import { and, eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../../src/access.js"
import type { Actor } from "../../src/actor.js"
import { App } from "../../src/app.js"
import { AppProfiles } from "../../src/app/profiles.js"
import { AppRegistry } from "../../src/app/registry.js"
import { AppResolve } from "../../src/app/resolve.js"
import { CredentialRequirements } from "../../src/credential-requirements.js"
import { Credentials } from "../../src/credentials.js"
import { EgressControl } from "../../src/egress-control.js"
import { Envelope } from "../../src/envelope.js"
import { OAuthFetch } from "../../src/oauth-fetch.js"
import { Space } from "../../src/space.js"
import { SpaceMember } from "../../src/space/member.js"
import { SpaceProvisioning } from "../../src/space/provisioning.js"
import { Seed } from "./seed.js"

export const invalidated: Array<EgressControl.Selector> = []

export const layer = Layer.mergeAll(
  App.layer,
  CredentialRequirements.layer.pipe(Layer.provideMerge(AppProfiles.layer)),
  AppResolve.layer,
  AppRegistry.layer,
  Space.layer,
  SpaceMember.layer,
  SpaceProvisioning.layer,
).pipe(
  Layer.provideMerge(Credentials.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Access.layer,
      Envelope.layerLocal,
      OAuthFetch.layerUnchecked,
      Layer.succeed(
        EgressControl.Service,
        EgressControl.Service.of({ invalidate: (selector) => Effect.sync(() => invalidated.push(selector)) }),
      ),
    ),
  ),
  Layer.provideMerge(Testing.layer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        ENVELOPE_KEYS: JSON.stringify([
          { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
        ]),
        REN_INTEGRATIONS_URL: "https://mcp.ren.test/managed",
      }),
    ),
  ),
)

export const user = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, name: string, role?: string) {
  const provisioning = yield* SpaceProvisioning.Service
  const database = yield* Database.Service
  const seeded = yield* Seed.user({ name })
  yield* Seed.member(organizationId, seeded.id, role ?? "member")
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  const personal = (yield* database.db
    .select({ id: Database.Schema.space.id })
    .from(Database.Schema.space)
    .innerJoin(Database.Schema.space_member, eq(Database.Schema.space_member.space_id, Database.Schema.space.id))
    .where(
      and(
        eq(Database.Schema.space_member.user_id, seeded.id),
        eq(Database.Schema.space.organization_id, organizationId),
        eq(Database.Schema.space.name, `${name}'s Personal Space`),
      ),
    )).at(0)
  if (!personal) return yield* Effect.die(new Error("expected a Personal Space"))
  return { userId: seeded.id, organizationId, roles: [role ?? "member"], personal: personal.id }
})

export type User = Effect.Success<ReturnType<typeof user>>

export const space = Effect.fnUntraced(function* (
  creator: Effect.Success<ReturnType<typeof user>>,
  name: string,
  others: ReadonlyArray<Effect.Success<ReturnType<typeof user>>> = [],
) {
  const spaces = yield* Space.Service
  const members = yield* SpaceMember.Service
  const created = yield* spaces.create(creator, { name })
  yield* Effect.forEach(others, (other) => members.create(creator, { spaceId: created.id, userId: other.userId }))
  return created.id
})

export const remote = (
  name: string,
  auth: Mcp.Auth = { type: "oauth", tokenEndpointAuth: "none" },
): Mcp.Declaration => ({
  name,
  description: `The ${name} server`,
  transport: { type: "remote", url: `https://${name.toLowerCase()}.example.com/mcp` },
  auth,
  requiredCredentials: [],
})

export const managed = (name: string, replaces?: string): Mcp.Declaration => ({
  name,
  description: `The ${name} server, paid with Ren credits`,
  transport: { type: "managed", server: name.toLowerCase(), ...(replaces && { replaces }) },
  auth: { type: "none" },
  requiredCredentials: [],
})

export const app = Effect.fnUntraced(function* (
  actor: Actor.Info,
  ownerSpaceId: SpaceSchema.ID,
  slug: string,
  definition: Parameters<typeof Seed.appInput>[2] = {},
) {
  const apps = yield* App.Service
  return yield* apps.create(actor, Seed.appInput(ownerSpaceId, slug, definition))
})

export const profile = Effect.fnUntraced(function* (
  actor: Actor.Info,
  input: Omit<AppProfile.CreateInput, "name"> & { readonly name?: string },
) {
  const profiles = yield* AppProfiles.Service
  return yield* profiles.create(actor, { ...input, name: input.name ?? input.slug })
})

// oxlint-disable-next-line ren/no-comments -- A connected item without a sign-in: the row a paste or a callback would write.
export const connect = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  profileId: AppProfile.ID,
  label: string,
  options: {
    readonly hosts?: ReadonlyArray<string>
    readonly madeFor?: string
    readonly holder?: Auth.UserID
    readonly fieldNames?: ReadonlyArray<string>
    readonly scopes?: ReadonlyArray<string>
  } = {},
) {
  const database = yield* Database.Service
  const envelope = yield* Envelope.Service
  const id = Credential.ID.create()
  const value = yield* envelope.seal(Redacted.make(`{"type":"key","value":"${label.toLowerCase()}-token"}`), {
    organizationId,
    kind: "credential",
    id,
  })
  yield* database.db.insert(Database.Schema.credential).values({
    id,
    organization_id: organizationId,
    owner: "profile",
    profile_id: profileId,
    label,
    type: options.fieldNames ? "fields" : "key",
    value,
    field_names: [...(options.fieldNames ?? [])],
    scopes: [...(options.scopes ?? [])],
    hosts: [...(options.hosts ?? ["api.example.com"])],
    inject: { op: "replace", in: ["header"] },
    made_for: options.madeFor ?? null,
    account_user_id: options.holder ?? null,
  })
  return id
})

// oxlint-disable-next-line ren/no-comments -- A space brain: its scope is the space, so its catalog is the space's reach.
export const catalog = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  spaceId: SpaceSchema.ID,
  options: { readonly egress?: boolean } = {},
) {
  const database = yield* Database.Service
  const resolve = yield* AppResolve.Service
  const existing = (yield* database.db
    .select({ id: Database.Schema.brain.id })
    .from(Database.Schema.brain)
    .where(and(eq(Database.Schema.brain.space_id, spaceId), eq(Database.Schema.brain.scope, "space")))).at(0)
  const brainId = existing?.id ?? Brain.ID.create()
  yield* existing
    ? database.db
        .update(Database.Schema.brain)
        .set({ egress: options.egress ?? true })
        .where(eq(Database.Schema.brain.id, brainId))
    : database.db.insert(Database.Schema.brain).values({
        id: brainId,
        organization_id: organizationId,
        space_id: spaceId,
        scope: "space",
        egress: options.egress ?? true,
      })
  const scope = yield* Credentials.scopeOf(database.db, { kind: "brain", id: brainId, generation: 1 })
  if (Option.isNone(scope)) return yield* Effect.die(new Error("expected a brain scope"))
  const resolved = yield* resolve.forScope(scope.value)
  return { scope: scope.value, fingerprint: resolved.fingerprint, catalog: resolved.catalog }
})

export const reach = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, spaceId: SpaceSchema.ID) {
  const profiles = yield* AppProfiles.Service
  return (yield* profiles.reachable({ organizationId, spaceId: Option.some(spaceId) })).map(
    (found) => `${found.appSlug}/${found.slug}`,
  )
})
