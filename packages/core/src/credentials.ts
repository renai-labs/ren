export * as Credentials from "./credentials.js"

import { Database } from "@ren/db/database"
import type { AppProfile } from "@ren/schema/app-profile"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Credential } from "@ren/schema/credential"
import type { Space } from "@ren/schema/space"
import type { Workload } from "@ren/schema/workload"
import {
  and,
  asc,
  count,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Cause, Clock, Context, DateTime, Duration, Effect, Layer, Option, Redacted, Result, Schema } from "effect"
import { SqlError } from "effect/sql"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { AppProfilePolicy } from "./app/profile-policy.js"
import { AppQueries } from "./app/queries.js"
import { ProfileItems } from "./app/profile-items.js"
import { ProfileLabel } from "./app/profile-label.js"
import { CredentialOffboarding } from "./credential/offboarding.js"
import { CredentialPolicy } from "./credential/policy.js"
import { EgressControl } from "./egress-control.js"
import { Envelope } from "./envelope.js"
import { McpProvider } from "./mcp-provider.js"
import { OAuthFetch } from "./oauth-fetch.js"
import { OAuthToken } from "./oauth-token.js"
import { Primitive } from "./primitive.js"

export type OwnerKind = Credential.OwnerKind | "workload"

// oxlint-disable-next-line ren/no-comments -- The order applies to loose keys; a profile label is unique among the credentials a workload reaches (profiles.md §13 rule 3).
export const lookupOrder: ReadonlyArray<OwnerKind> = ["workload", "profile", "person", "space", "org"]

// oxlint-disable-next-line ren/no-comments -- What a workload may use: its own credentials, its org's, its space's while it serves that space, and one person's only when it serves that person alone (README §6.4 rules 2, A37).
export interface Scope {
  readonly organizationId: Auth.OrganizationID
  readonly workload: Workload.Info
  readonly spaceId: Option.Option<Space.ID>
  readonly person: Option.Option<Auth.UserID>
}

// oxlint-disable-next-line ren/no-comments -- `revision` is set when Ren can renew the value after an upstream 401: sign-ins, client credentials and provider routes at their stored revision, minted values at 0 (K16, §9 rule 7).
export interface Candidate {
  readonly id: string
  readonly source: string
  readonly label: string
  readonly owner: OwnerKind
  readonly hosts: ReadonlyArray<string>
  readonly inject: Credential.Inject
  readonly type?: Credential.Type
  readonly revision?: number | null
  readonly status?: Credential.Status
}

export const refreshableTypes: ReadonlyArray<Credential.Type> = ["oauth", "client_credentials", "route"]

export const maximumWantedScopes = 64

export const unauthorizedEvery = Duration.minutes(5)

export interface Request {
  readonly host: string
  readonly placeholders: ReadonlyArray<string>
}

export interface Matched {
  readonly candidate: Candidate
  readonly placeholder: Option.Option<{ readonly text: string; readonly field: Option.Option<string> }>
}

export type Match =
  | { readonly ok: true; readonly matches: ReadonlyArray<Matched> }
  | {
      readonly ok: false
      readonly reason: "host_not_allowed" | "credential_missing" | "ambiguous"
      readonly label?: string
    }

const parse = (text: string) => {
  const found = [...text.matchAll(Credential.placeholderPattern)].at(0)
  const label = found?.at(1)
  return label ? { label, field: Option.fromNullishOr(found?.at(2)) } : undefined
}

const allowsHost = (candidate: Candidate, request: Request) =>
  candidate.hosts.some((pattern) => Credential.matchesHost(pattern, request.host))

const byOrder = (candidates: ReadonlyArray<Candidate>) =>
  candidates.toSorted((left, right) => lookupOrder.indexOf(left.owner) - lookupOrder.indexOf(right.owner))

// oxlint-disable-next-line ren/no-comments -- README §6.3. A placeholder takes the first credential of its label in the lookup order; that credential must allow the host. Without placeholders, the credentials that inject by host (`setHeader`, `route`) for this host apply, and two labels for one host are `ambiguous`.
export const match = (candidates: ReadonlyArray<Candidate>, request: Request): Match => {
  const ordered = byOrder(candidates)
  const placeholders = request.placeholders.flatMap((text) => {
    const parsed = parse(text)
    return parsed ? [{ text, ...parsed }] : []
  })
  if (placeholders.length === 0) {
    const byHost = ordered.filter(
      (candidate) =>
        candidate.inject.op !== "replace" && candidate.source !== "provider" && allowsHost(candidate, request),
    )
    const chosen = [...new Map(byHost.toReversed().map((candidate) => [candidate.label, candidate])).values()]
    if (chosen.length > 1) return { ok: false, reason: "ambiguous" }
    return { ok: true, matches: chosen.map((candidate) => ({ candidate, placeholder: Option.none() })) }
  }
  const matches: Array<Matched> = []
  for (const placeholder of placeholders) {
    const labelled = ordered.filter((candidate) => candidate.label === placeholder.label)
    const owner = labelled.at(0)?.owner
    const sameOwner = labelled.filter((candidate) => candidate.owner === owner)
    const allowed = sameOwner.filter((candidate) => allowsHost(candidate, request))
    const candidate = allowed.at(0)
    if (labelled.length === 0) return { ok: false, reason: "credential_missing", label: placeholder.label }
    if (!candidate) return { ok: false, reason: "host_not_allowed", label: placeholder.label }
    matches.push({ candidate, placeholder: Option.some({ text: placeholder.text, field: placeholder.field }) })
  }
  return { ok: true, matches }
}

const Token = Schema.RedactedFromValue(Schema.String)

// oxlint-disable-next-line ren/no-comments -- What a credential's `value` holds once opened. Core only: refresh data, Composio session URLs and cleared values never reach `@ren/schema` (connections.md §6.1).
export const Sealed = Schema.Union([
  ...Credential.Pasted.members,
  Schema.Struct({
    type: Schema.Literal("oauth"),
    accessToken: Token,
    issuer: Schema.optional(Schema.String),
    refresh: Schema.optional(
      Schema.Struct({
        refreshToken: Token,
        clientId: Schema.String,
        clientSecret: Schema.optional(Token),
        tokenEndpoint: Schema.String,
        tokenEndpointAuth: Schema.Literals(["none", "client_secret_basic", "client_secret_post"]),
        resource: Schema.optional(Schema.String),
        scope: Schema.optional(Schema.String),
      }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("client_credentials"),
    clientId: Schema.String,
    clientSecret: Token,
    tokenEndpoint: Schema.String,
    tokenEndpointAuth: Schema.Literals(["client_secret_post", "client_secret_basic"]),
    scope: Schema.optional(Schema.String),
    accessToken: Schema.optional(Token),
  }),
  Schema.Struct({ type: Schema.Literal("route"), state: McpProvider.State }),
  Schema.Struct({ type: Schema.Literal("cleared") }),
])
export type Sealed = typeof Sealed.Type

export interface Opened {
  readonly id: Credential.ID
  readonly value: Sealed
  readonly revision: number
  readonly provider: Option.Option<Credential.Provider>
  readonly expiresAt?: DateTime.Utc
}

type Methods = Primitive.Interface<typeof Credential.definition>

export interface Interface extends Omit<Methods, "rotate" | "update"> {
  readonly update: (
    actor: Actor.Info,
    id: Credential.ID,
    input: Credential.UpdateInput,
  ) => Effect.Effect<Credential.Info, Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict | Primitive.Invalid>
  readonly rotate: (
    actor: Actor.Info,
    id: Credential.ID,
    input: Credential.RotateInput,
  ) => Effect.Effect<Credential.Info, Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict | Primitive.Invalid>
  readonly scopeOf: (workload: Workload.Info) => Effect.Effect<Option.Option<Scope>>
  readonly candidates: (
    scope: Scope,
    profileIds: ReadonlyArray<AppProfile.ID>,
  ) => Effect.Effect<ReadonlyArray<Candidate>>
  readonly environment: (
    scope: Scope,
    profileIds: ReadonlyArray<AppProfile.ID>,
  ) => Effect.Effect<Readonly<Record<string, string>>>
  readonly open: (id: Credential.ID) => Effect.Effect<Option.Option<Opened>>
  readonly authorize: (
    actor: Actor.Info,
    owner: Credential.Owner,
  ) => Effect.Effect<void, Primitive.NotFound | Primitive.Forbidden>
  readonly profile: (
    actor: Actor.Info,
    profileId: AppProfile.ID,
  ) => Effect.Effect<
    {
      readonly profile: typeof Database.Schema.app_profile.$inferSelect
      readonly app: typeof Database.Schema.app.$inferSelect
    },
    Primitive.NotFound | Primitive.Forbidden
  >
  readonly claimUnauthorized: (id: Credential.ID, revision: number) => Effect.Effect<boolean>
  readonly addWantedScopes: (id: Credential.ID, scopes: ReadonlyArray<string>) => Effect.Effect<void>
  readonly removeForMember: (organizationId: Auth.OrganizationID, userId: Auth.UserID) => Effect.Effect<void>
  readonly removeForSpaceMember: (spaceId: Space.ID, userId: Auth.UserID) => Effect.Effect<void>
  readonly removeForSpace: (spaceId: Space.ID) => Effect.Effect<void>
  readonly removeForProfile: (profileId: AppProfile.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Credentials") {}

const table = Database.Schema.credential
const users = Database.Schema.user
const members = Database.Schema.space_member
const profiles = Database.Schema.app_profile
const listed = Database.Schema.app_profile_space

const fence = (actor: Actor.Info) => Actor.fenced(actor, members.space_id) ?? sql`true`

export const scopeOf = Effect.fnUntraced(function* (
  client: Pick<Database.Transaction, "select">,
  workload: Workload.Info,
) {
  const brainId = workload.kind === "brain" ? workload.id : Brain.ID.make(`brn_${workload.id.slice(4)}`)
  const found = (yield* client
    .select({ brain: Database.Schema.brain, space: Database.Schema.space })
    .from(Database.Schema.brain)
    .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.brain.space_id))
    .where(eq(Database.Schema.brain.id, brainId))).at(0)
  if (!found) return Option.none<Scope>()
  return Option.some({
    organizationId: found.brain.organization_id,
    workload,
    spaceId: Option.some(found.brain.space_id),
    person:
      found.space.kind === "private" && !found.space.archived_at
        ? Option.fromNullishOr(found.space.owner_user_id)
        : Option.none(),
  } satisfies Scope)
})

const notFound = new Primitive.NotFound({ message: "Credential not found." })

const actions = CredentialPolicy.actions

const ValueJson = Schema.fromJsonString(Sealed)
const encodeValue = Schema.encodeSync(ValueJson)
const decodeValue = Schema.decodeUnknownOption(ValueJson)

const sealedOf = (value: Credential.Value): Sealed =>
  value.type === "client_credentials"
    ? {
        type: "client_credentials",
        clientId: value.clientId,
        clientSecret: value.clientSecret,
        tokenEndpoint: value.tokenEndpoint,
        tokenEndpointAuth: value.tokenEndpointAuth ?? "client_secret_post",
        ...(value.scopes && { scope: value.scopes.join(" ") }),
      }
    : value

const previewOf = (value: Sealed) => {
  if (value.type === "key") return Redacted.value(value.value).slice(-4)
  if (value.type === "basic") return value.username
  return null
}

const fieldNamesOf = (value: Sealed) => (value.type === "fields" ? Object.keys(value.fields) : [])

const ownerOf = (row: typeof table.$inferSelect): Credential.Owner | undefined => {
  if (row.owner === "org") return { kind: "org" }
  if (row.owner === "space" && row.space_id) return { kind: "space", spaceId: row.space_id }
  if (row.owner === "person" && row.user_id) return { kind: "person", userId: row.user_id }
  if (row.owner === "profile" && row.profile_id) return { kind: "profile", profileId: row.profile_id }
  return undefined
}

const ownerColumns = (owner: Credential.Owner) => ({
  owner: owner.kind,
  space_id: owner.kind === "space" ? owner.spaceId : null,
  user_id: owner.kind === "person" ? owner.userId : null,
  profile_id: owner.kind === "profile" ? owner.profileId : null,
})

const labelConstraints: ReadonlyArray<string> = Object.values(Database.Schema.credentialOwnerLabelConstraints)

// oxlint-disable-next-line ren/no-comments -- A second credential with one label on one owner is an error, never a silent replace (README §6.4 rule 5, `LabelTaken`).
const labelTaken = (error: EffectDrizzleQueryError) => {
  const failure = Cause.isCause(error.cause) ? Cause.findErrorOption(error.cause) : Option.none()
  return Option.isSome(failure) &&
    SqlError.isSqlError(failure.value) &&
    failure.value.reason._tag === "UniqueViolation" &&
    labelConstraints.includes(failure.value.reason.constraint)
    ? Effect.fail(
        new Primitive.Conflict({ message: "This owner already has a credential with this label (LabelTaken)." }),
      )
    : Effect.die(error)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const envelope = yield* Envelope.Service
    const control = yield* EgressControl.Service
    const http = yield* OAuthFetch.Service

    // oxlint-disable-next-line ren/no-comments -- §10c rules 1 and 3 (K42): Ren exchanges once before it saves; a failed exchange fails the write with the provider's code.
    const exchange = Effect.fnUntraced(function* (value: Sealed) {
      if (value.type !== "client_credentials") return { value, expiresAt: null }
      const answered = yield* OAuthToken.exchangeClientCredentials(http.fetch, value).pipe(
        Effect.mapError(
          () => new Primitive.Invalid({ message: "Ren could not reach the token endpoint.", field: "value" }),
        ),
      )
      if (Result.isFailure(answered))
        return yield* new Primitive.Invalid({
          message: `The token endpoint refused the client id and secret (${answered.failure.code}).`,
          field: "value",
        })
      const now = yield* Clock.currentTimeMillis
      return {
        value: { ...value, accessToken: Redacted.make(answered.success.accessToken) },
        expiresAt: Option.getOrNull(
          Option.map(answered.success.expiresIn, (seconds) => new Date(now + seconds * 1000)),
        ),
      }
    })

    const contextOf = (organizationId: Auth.OrganizationID, id: Credential.ID): Envelope.Context => ({
      organizationId,
      kind: "credential",
      id,
    })

    const membershipOf = (actor: Actor.Info) =>
      exists(
        database.db
          .select({ one: sql`1` })
          .from(members)
          .where(
            and(
              eq(members.space_id, table.space_id),
              eq(members.user_id, actor.userId),
              isNull(members.archived_at),
              Actor.fenced(actor, members.space_id),
            ),
          ),
      )

    // oxlint-disable-next-line ren/no-comments -- The SQL of each credential fact, for a list or a lookup.
    const facts = (actor: Actor.Info): ReadonlyMap<string, SQL> =>
      new Map([
        [CredentialPolicy.facts.org, eq(table.owner, "org")],
        [CredentialPolicy.facts.spaceMember, and(eq(table.owner, "space"), membershipOf(actor)) ?? sql`false`],
        [
          CredentialPolicy.facts.self,
          Actor.isFenced(actor)
            ? sql`false`
            : (and(eq(table.owner, "person"), eq(table.user_id, actor.userId)) ?? sql`false`),
        ],
        [CredentialPolicy.facts.person, eq(table.owner, "person")],
        [
          CredentialPolicy.facts.profile,
          and(
            eq(table.owner, "profile"),
            // oxlint-disable-next-line ren/no-comments -- profiles.md §10: whoever connects the profile's items sees its credentials.
            exists(
              database.db
                .select({ one: sql`1` })
                .from(profiles)
                .where(
                  and(
                    eq(profiles.id, table.profile_id),
                    Access.where(access.plan(actor, AppProfilePolicy.actions.connect), AppQueries.profileWhere(actor)),
                  ),
                ),
            ),
          ) ?? sql`false`,
        ],
        [CredentialPolicy.facts.inProfile, eq(table.owner, "profile")],
        [
          CredentialPolicy.facts.signIn,
          or(isNotNull(table.account_user_id), notInArray(table.type, ["key", "basic", "fields"])) ?? sql`false`,
        ],
        [
          CredentialPolicy.facts.foreignAccount,
          and(isNotNull(table.account_user_id), ne(table.account_user_id, actor.userId)) ?? sql`false`,
        ],
      ])

    const visible = (actor: Actor.Info, action: string) =>
      and(
        eq(table.organization_id, actor.organizationId),
        ne(table.owner, "workload"),
        Access.where(access.plan(actor, action), facts(actor)),
      )

    const contextFor = (actor: Actor.Info, options: { readonly isSpaceMember: boolean }): CredentialPolicy.Context => ({
      userId: actor.userId,
      isSpaceMember: options.isSpaceMember,
      isFenced: Actor.isFenced(actor),
    })

    const resourceOf = Effect.fnUntraced(function* (actor: Actor.Info, owner: Credential.Owner) {
      if (owner.kind !== "space")
        return Option.some(CredentialPolicy.resource(owner, contextFor(actor, { isSpaceMember: false })))
      const spaces = yield* database.db
        .select({ id: Database.Schema.space.id, membershipId: members.id })
        .from(Database.Schema.space)
        .leftJoin(
          members,
          and(
            eq(members.space_id, Database.Schema.space.id),
            eq(members.user_id, actor.userId),
            isNull(members.archived_at),
            Actor.fenced(actor, members.space_id),
          ),
        )
        .where(
          and(
            eq(Database.Schema.space.id, owner.spaceId),
            eq(Database.Schema.space.organization_id, actor.organizationId),
            isNull(Database.Schema.space.archived_at),
          ),
        )
        .pipe(Effect.orDie)
      const space = spaces.at(0)
      if (!space) return Option.none()
      return Option.some(
        CredentialPolicy.resource(owner, contextFor(actor, { isSpaceMember: Boolean(space.membershipId) })),
      )
    })

    const isAllowed = (actor: Actor.Info, action: string, resource: Access.Resource) =>
      access.isAllowed({ actor, action, resource })

    // oxlint-disable-next-line ren/no-comments -- profiles.md §10: anyone who sees a shared profile connects its items (P27); a private profile's person only.
    const profileOf = Effect.fnUntraced(function* (actor: Actor.Info, profileId: AppProfile.ID) {
      const row = (yield* database.db
        .select({
          profile: profiles,
          app: Database.Schema.app,
          isListedMember: sql<boolean>`exists (select 1 from ${listed} inner join ${members} on ${members.space_id} = ${listed.space_id} where ${listed.profile_id} = ${profiles.id} and ${members.user_id} = ${actor.userId} and ${members.archived_at} is null and ${fence(actor)})`,
        })
        .from(profiles)
        .innerJoin(Database.Schema.app, eq(Database.Schema.app.id, profiles.app_id))
        .where(and(eq(profiles.id, profileId), eq(profiles.organization_id, actor.organizationId)))
        .pipe(Effect.orDie)).at(0)
      const holds = row && {
        kind: row.profile.kind,
        isCreator: row.profile.created_by_user_id === actor.userId,
        isListedMember: row.isListedMember,
        allSpaces: row.profile.all_spaces,
        isSelf: row.profile.user_id === actor.userId && !Actor.isFenced(actor),
      }
      const resource = holds && AppProfilePolicy.resource(holds)
      if (!row || !resource || !isAllowed(actor, AppProfilePolicy.actions.get, resource))
        return yield* new Primitive.NotFound({ message: "Profile not found." })
      if (!isAllowed(actor, AppProfilePolicy.actions.connect, resource))
        return yield* new Primitive.Forbidden({ message: "You cannot connect the accounts of this profile." })
      return row
    })

    const checkTarget = Effect.fnUntraced(function* (actor: Actor.Info, owner: Credential.Owner, verb: string) {
      if (owner.kind === "profile") return yield* Effect.asVoid(profileOf(actor, owner.profileId))
      const resource = yield* resourceOf(actor, owner)
      if (Option.isNone(resource)) return yield* new Primitive.NotFound({ message: "The target owner was not found." })
      if (owner.kind === "person") {
        const isMember = yield* database.db
          .select({ id: Database.Schema.member.id })
          .from(Database.Schema.member)
          .where(
            and(
              eq(Database.Schema.member.organizationId, actor.organizationId),
              eq(Database.Schema.member.userId, owner.userId),
            ),
          )
          .pipe(Effect.orDie)
        if (isMember.length === 0) return yield* new Primitive.NotFound({ message: "The target owner was not found." })
      }
      if (!isAllowed(actor, actions.create, resource.value))
        return yield* new Primitive.Forbidden({ message: `You cannot ${verb} credentials for this owner.` })
    })

    // oxlint-disable-next-line ren/no-comments -- A39: a by-host credential for any host would go on every request, and a profile item's host names its MCP URL.
    const checkAnyHost = (owner: Credential.Owner, hosts: ReadonlyArray<string>, inject: Credential.Inject) =>
      hosts.includes(Credential.anyHost) && (owner.kind === "profile" || inject.op !== "replace")
        ? Effect.fail(
            new Primitive.Invalid({
              message: "Only a key used through its placeholder can go to any host.",
              field: "hosts",
            }),
          )
        : Effect.void

    const checkDelivery = Effect.fnUntraced(function* (
      actor: Actor.Info,
      owner: Credential.Owner,
      delivery: Credential.Delivery | undefined,
    ) {
      if (delivery !== "delivered") return
      const resource = yield* resourceOf(actor, owner)
      if (Option.isNone(resource) || !isAllowed(actor, actions.deliver, resource.value))
        return yield* new Primitive.Forbidden({ message: "You cannot choose delivered for this owner." })
    })

    // oxlint-disable-next-line ren/no-comments -- A24: the count runs under a lock on the owner's row, so two creates at 99 cannot both pass.
    const lockOwner = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      organizationId: Auth.OrganizationID,
      owner: Credential.Owner,
    ) {
      if (owner.kind === "space")
        yield* transaction
          .select({ id: Database.Schema.space.id })
          .from(Database.Schema.space)
          .where(eq(Database.Schema.space.id, owner.spaceId))
          .for("update")
      else if (owner.kind === "profile")
        yield* transaction
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.id, owner.profileId))
          .for("update")
      else if (owner.kind === "person")
        yield* transaction
          .select({ id: Database.Schema.member.id })
          .from(Database.Schema.member)
          .where(
            and(
              eq(Database.Schema.member.organizationId, organizationId),
              eq(Database.Schema.member.userId, owner.userId),
            ),
          )
          .for("update")
      else
        yield* transaction
          .select({ id: Database.Schema.organization.id })
          .from(Database.Schema.organization)
          .where(eq(Database.Schema.organization.id, organizationId))
          .for("update")
      const columns = ownerColumns(owner)
      const counted = yield* transaction
        .select({ total: count() })
        .from(table)
        .where(
          and(
            eq(table.organization_id, organizationId),
            eq(table.owner, columns.owner),
            columns.space_id ? eq(table.space_id, columns.space_id) : undefined,
            columns.user_id ? eq(table.user_id, columns.user_id) : undefined,
            columns.profile_id ? eq(table.profile_id, columns.profile_id) : undefined,
          ),
        )
      if ((counted.at(0)?.total ?? 0) >= Credential.maximumPerOwner)
        return yield* new Primitive.Conflict({
          message: `This owner already has ${Credential.maximumPerOwner} credentials (LimitReached).`,
        })
    })

    // oxlint-disable-next-line ren/no-comments -- A read already passed the policy, so a space credential's reader is a space member.
    const toInfo = (
      actor: Actor.Info,
      row: typeof table.$inferSelect,
      accountName: string | null,
    ): Credential.Info | undefined => {
      const owner = ownerOf(row)
      if (!owner) return undefined
      const canPreview = isAllowed(
        actor,
        actions.preview,
        CredentialPolicy.resource(owner, contextFor(actor, { isSpaceMember: true })),
      )
      return {
        id: row.id,
        organizationId: row.organization_id,
        owner,
        label: row.label,
        name: row.name,
        type: row.type,
        keyPreview: canPreview ? row.key_preview : null,
        fieldNames: row.field_names,
        hosts: row.hosts,
        inject: row.inject,
        delivery: row.delivery,
        account: row.account_user_id ? { userId: row.account_user_id, name: accountName ?? "" } : null,
        scopes: row.scopes,
        status: row.status,
        profileId: row.profile_id,
        provider: row.provider,
        expiresAt: row.expires_at && DateTime.fromDateUnsafe(row.expires_at),
        createdBy: row.created_by_user_id,
        createdAt: DateTime.fromDateUnsafe(row.created_at),
        updatedAt: DateTime.fromDateUnsafe(row.updated_at),
      }
    }

    const selectInfo = (where: SQL | undefined) =>
      database.db
        .select({ row: table, accountName: users.name })
        .from(table)
        .leftJoin(users, eq(users.id, table.account_user_id))
        .where(where)
        .pipe(Effect.orDie)

    const find = Effect.fnUntraced(function* (actor: Actor.Info, id: string, action: string) {
      if (!Schema.is(Credential.ID)(id)) return yield* notFound
      const found = (yield* selectInfo(and(eq(table.id, id), visible(actor, action)))).at(0)
      if (!found) {
        const seen = (yield* selectInfo(and(eq(table.id, id), visible(actor, actions.get)))).at(0)
        if (seen) return yield* new Primitive.Forbidden({ message: "You cannot change this credential." })
        return yield* notFound
      }
      return found
    })

    const infoById = Effect.fnUntraced(function* (actor: Actor.Info, id: Credential.ID) {
      const found = (yield* selectInfo(eq(table.id, id))).at(0)
      const info = found && toInfo(actor, found.row, found.accountName)
      if (!info) return yield* notFound
      return info
    })

    const insert = Effect.fnUntraced(function* (
      actor: Actor.Info,
      owner: Credential.Owner,
      input: {
        readonly label: string
        readonly name: string | null
        readonly type: Credential.Type
        readonly value: Sealed
        readonly hosts: ReadonlyArray<string>
        readonly inject: Credential.Inject
        readonly delivery: Credential.Delivery
        readonly accountUserId: Auth.UserID | null
        readonly expiresAt?: Date | null
        readonly madeFor?: string
      },
    ) {
      const id = Credential.ID.create()
      const sealed = yield* envelope
        .seal(Redacted.make(encodeValue(input.value)), contextOf(actor.organizationId, id))
        .pipe(Effect.orDie)
      yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          yield* lockOwner(transaction, actor.organizationId, owner)
          yield* transaction
            .insert(table)
            .values({
              id,
              organization_id: actor.organizationId,
              ...ownerColumns(owner),
              label: input.label,
              name: input.name,
              type: input.type,
              value: sealed,
              key_preview: previewOf(input.value),
              field_names: fieldNamesOf(input.value),
              hosts: [...input.hosts],
              inject: input.inject,
              delivery: input.delivery,
              account_user_id: input.accountUserId,
              expires_at: input.expiresAt ?? null,
              made_for: input.madeFor ?? null,
              created_by_user_id: actor.userId,
            })
            .pipe(Effect.catchTag("EffectDrizzleQueryError", labelTaken))
        }),
      )
      return yield* infoById(actor, id)
    })

    const reaches = (scope: Scope) =>
      and(
        eq(table.organization_id, scope.organizationId),
        or(
          eq(table.owner, "org"),
          Option.match(scope.spaceId, {
            onNone: () => undefined,
            onSome: (spaceId) => and(eq(table.owner, "space"), eq(table.space_id, spaceId)),
          }),
          Option.match(scope.person, {
            onNone: () => undefined,
            onSome: (userId) => and(eq(table.owner, "person"), eq(table.user_id, userId)),
          }),
          and(
            eq(table.owner, "workload"),
            eq(table.workload_kind, scope.workload.kind),
            eq(table.workload_id, scope.workload.id),
          ),
        ),
      )

    const openRow = Effect.fnUntraced(function* (row: typeof table.$inferSelect) {
      const opened = yield* envelope.open(row.value, contextOf(row.organization_id, row.id)).pipe(Effect.orDie)
      return decodeValue(Redacted.value(opened))
    })

    const removed = (labels: ReadonlyArray<string>) =>
      Effect.forEach(labels, (label) => control.invalidate({ label }), { discard: true })

    const offboard = <A extends CredentialOffboarding.Removed, E>(
      run: (transaction: Database.Transaction) => Effect.Effect<A, E>,
    ) =>
      database
        .transaction(run)
        .pipe(
          Effect.orDie,
          Effect.flatMap(CredentialOffboarding.invalidate),
          Effect.provideService(EgressControl.Service, control),
        )

    // oxlint-disable-next-line ren/no-comments -- profiles.md §13 rule 2: of the given profiles' credentials, only the labels of items the app declares now count; the egress refuses an unused one.
    const currentOf = Effect.fnUntraced(function* (scope: Scope, profileIds: ReadonlyArray<AppProfile.ID>) {
      if (!profileIds.length) return []
      const rows = yield* database.db
        .select({ id: profiles.id, slug: profiles.slug, app: Database.Schema.app })
        .from(profiles)
        .innerJoin(Database.Schema.app, eq(Database.Schema.app.id, profiles.app_id))
        .where(and(inArray(profiles.id, [...profileIds]), eq(profiles.organization_id, scope.organizationId)))
        .pipe(Effect.orDie)
      return rows.map((row) => {
        const declared = ProfileItems.declared(
          { mcps: row.app.mcps, skills: row.app.skills, requiredCredentials: row.app.required_credentials },
          row.slug,
        )
        return {
          profileId: row.id,
          labels: declared.map((item) => item.label),
          envLabels: declared.filter((item) => "env" in item.item).map((item) => item.label),
        }
      })
    })

    return Service.of({
      list: Effect.fn("Credentials.list")(function* (actor: Actor.Info, input: Credential.ListInput) {
        const where = and(
          visible(actor, actions.list),
          input.owner ? eq(table.owner, input.owner) : undefined,
          input.spaceId ? eq(table.space_id, input.spaceId) : undefined,
          input.type ? eq(table.type, input.type) : undefined,
          input.search
            ? or(ilike(table.label, `%${input.search}%`), ilike(table.name, `%${input.search}%`))
            : undefined,
        )
        const rows = yield* database.db
          .select({ row: table, accountName: users.name })
          .from(table)
          .leftJoin(users, eq(users.id, table.account_user_id))
          .where(where)
          .orderBy(asc(table.label), asc(table.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize)
          .pipe(Effect.orDie)
        const totals = yield* database.db.select({ total: count() }).from(table).where(where).pipe(Effect.orDie)
        return {
          items: rows.flatMap((row) => toInfo(actor, row.row, row.accountName) ?? []),
          page: input.page,
          pageSize: input.pageSize,
          total: totals.at(0)?.total ?? 0,
        }
      }),

      get: Effect.fn("Credentials.get")(function* (actor: Actor.Info, id: string) {
        const found = yield* find(actor, id, actions.get).pipe(
          Effect.catchTag("Primitive.Forbidden", () => Effect.fail(notFound)),
        )
        const info = toInfo(actor, found.row, found.accountName)
        if (!info) return yield* notFound
        return info
      }),

      create: Effect.fn("Credentials.create")(function* (actor: Actor.Info, input: Credential.CreateInput) {
        if ("item" in input) {
          const owner = input.owner
          const found = yield* profileOf(actor, owner.profileId)
          const declared = ProfileItems.declared(
            {
              mcps: found.app.mcps,
              skills: found.app.skills,
              requiredCredentials: found.app.required_credentials,
            },
            found.profile.slug,
          )
          const label = ProfileLabel.labelOf(input.item, found.profile.slug)
          const item = declared.find((entry) => entry.label === label)
          if (!item) return yield* new Primitive.NotFound({ message: "The app has no such item." })
          if (item.kind === "oauth" || item.kind === "provider")
            return yield* new Primitive.Invalid({ message: "This item connects with a sign-in.", field: "item" })
          yield* checkAnyHost(owner, input.hosts, Credential.defaultInject(input.value.type))
          const exchanged = yield* exchange(sealedOf(input.value))
          const created = yield* insert(actor, owner, {
            label,
            name: item.name,
            type: input.value.type,
            value: exchanged.value,
            expiresAt: exchanged.expiresAt,
            hosts: input.hosts,
            inject: Credential.defaultInject(input.value.type),
            delivery: "egress",
            accountUserId: null,
            madeFor: item.madeFor,
          })
          yield* removed([label])
          return created
        }
        yield* checkTarget(actor, input.owner, "create")
        yield* checkDelivery(actor, input.owner, input.delivery)
        yield* checkAnyHost(input.owner, input.hosts, input.inject ?? Credential.defaultInject(input.value.type))
        if (input.value.type === "client_credentials" && input.owner.kind === "person")
          return yield* new Primitive.Invalid({
            message: "Client credentials reach an app’s own account; save them for a space or the org.",
            field: "owner",
          })
        const exchanged = yield* exchange(sealedOf(input.value))
        return yield* insert(actor, input.owner, {
          label: input.label,
          name: input.name ?? null,
          type: input.value.type,
          value: exchanged.value,
          expiresAt: exchanged.expiresAt,
          hosts: input.hosts,
          inject: input.inject ?? Credential.defaultInject(input.value.type),
          delivery: input.delivery ?? "egress",
          accountUserId: null,
        })
      }),

      update: Effect.fn("Credentials.update")(function* (
        actor: Actor.Info,
        id: Credential.ID,
        input: Credential.UpdateInput,
      ) {
        const found = yield* find(actor, id, actions.update)
        const owner = ownerOf(found.row)
        if (!owner) return yield* notFound
        yield* checkDelivery(actor, owner, input.delivery)
        if (input.hosts) yield* checkAnyHost(owner, input.hosts, found.row.inject)
        yield* database.db
          .update(table)
          .set({
            name: input.name,
            hosts: input.hosts && [...input.hosts],
            delivery: input.delivery,
            updated_at: sql`now()`,
          })
          .where(eq(table.id, id))
          .pipe(Effect.orDie)
        if (input.hosts || input.delivery) yield* removed([found.row.label])
        return yield* infoById(actor, id)
      }),

      rotate: Effect.fn("Credentials.rotate")(function* (
        actor: Actor.Info,
        id: Credential.ID,
        input: Credential.RotateInput,
      ) {
        const found = yield* find(actor, id, actions.rotate)
        if (found.row.type !== input.value.type)
          return yield* new Primitive.Invalid({
            message: `This credential holds a ${found.row.type} value. To change its type, delete it and create a new one (TypeChange).`,
            field: "value",
          })
        const exchanged = yield* exchange(sealedOf(input.value))
        const sealed = yield* envelope
          .seal(Redacted.make(encodeValue(exchanged.value)), contextOf(found.row.organization_id, id))
          .pipe(Effect.orDie)
        yield* database.db
          .update(table)
          .set({
            value: sealed,
            key_preview: previewOf(exchanged.value),
            field_names: fieldNamesOf(exchanged.value),
            expires_at: exchanged.expiresAt,
            revision: sql`${table.revision} + 1`,
            status: "ok",
            updated_at: sql`now()`,
          })
          .where(eq(table.id, id))
          .pipe(Effect.orDie)
        yield* removed([found.row.label])
        return yield* infoById(actor, id)
      }),

      move: Effect.fn("Credentials.move")(function* (
        actor: Actor.Info,
        id: Credential.ID,
        input: Credential.MoveInput,
      ) {
        const found = yield* find(actor, id, actions.move)
        const target = CredentialPolicy.moveTo(
          { accountUserId: found.row.account_user_id },
          input.owner,
          contextFor(actor, { isSpaceMember: false }),
        )
        if (!isAllowed(actor, actions.moveTo, target))
          return yield* new Primitive.Forbidden({
            message: "An account credential moves only to a space or to its holder.",
          })
        yield* checkTarget(actor, input.owner, "move")
        yield* checkDelivery(actor, input.owner, found.row.delivery)
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* lockOwner(transaction, actor.organizationId, input.owner)
            yield* transaction
              .update(table)
              .set({ ...ownerColumns(input.owner), updated_at: sql`now()` })
              .where(eq(table.id, id))
              .pipe(Effect.catchTag("EffectDrizzleQueryError", labelTaken))
          }),
        )
        yield* removed([found.row.label])
        return yield* infoById(actor, id)
      }),

      copy: Effect.fn("Credentials.copy")(function* (
        actor: Actor.Info,
        id: Credential.ID,
        input: Credential.MoveInput,
      ) {
        const found = yield* find(actor, id, actions.copy)
        yield* checkTarget(actor, input.owner, "copy")
        yield* checkDelivery(actor, input.owner, found.row.delivery)
        const value = yield* openRow(found.row)
        if (Option.isNone(value)) return yield* Effect.die(new Error(`Credential ${id} holds a value Ren cannot read`))
        return yield* insert(actor, input.owner, {
          label: found.row.label,
          name: found.row.name,
          type: found.row.type,
          value: value.value,
          hosts: found.row.hosts,
          inject: found.row.inject,
          delivery: found.row.delivery,
          accountUserId: null,
        })
      }),

      remove: Effect.fn("Credentials.remove")(function* (actor: Actor.Info, id: Credential.ID) {
        const found = yield* find(actor, id, actions.remove)
        const info = toInfo(actor, found.row, found.accountName)
        if (!info) return yield* notFound
        yield* database.db.delete(table).where(eq(table.id, id)).pipe(Effect.orDie)
        yield* CredentialOffboarding.invalidate({
          labels: [found.row.label],
          workloads: [],
          providers: found.row.provider
            ? [
                {
                  id,
                  organizationId: found.row.organization_id,
                  provider: found.row.provider,
                  accountId: found.row.provider_account_id,
                  value: found.row.value,
                },
              ]
            : [],
        }).pipe(Effect.provideService(EgressControl.Service, control))
        return info
      }),

      scopeOf: Effect.fn("Credentials.scopeOf")(function* (workload: Workload.Info) {
        return yield* scopeOf(database.db, workload).pipe(Effect.orDie)
      }),

      candidates: Effect.fn("Credentials.candidates")(function* (
        scope: Scope,
        profileIds: ReadonlyArray<AppProfile.ID>,
      ) {
        const columns = {
          id: table.id,
          label: table.label,
          owner: table.owner,
          hosts: table.hosts,
          inject: table.inject,
          type: table.type,
          revision: table.revision,
          status: table.status,
        }
        const loose = yield* database.db
          .select(columns)
          .from(table)
          .where(and(eq(table.delivery, "egress"), reaches(scope)))
          .pipe(Effect.orDie)
        const current = yield* currentOf(scope, profileIds)
        const owned = current.length
          ? yield* database.db
              .select(columns)
              .from(table)
              .where(
                and(
                  eq(table.owner, "profile"),
                  inArray(
                    table.profile_id,
                    current.map((entry) => entry.profileId),
                  ),
                ),
              )
              .pipe(Effect.orDie)
          : []
        const labels = new Set(current.flatMap((entry) => entry.labels))
        return [...loose, ...owned.filter((row) => labels.has(row.label))].map((row): Candidate => ({
          id: row.id,
          source: row.type === "route" ? "provider" : "static",
          label: row.label,
          owner: row.owner,
          hosts: row.hosts,
          inject: row.inject,
          type: row.type,
          status: row.status,
          revision: refreshableTypes.includes(row.type) ? row.revision : null,
        }))
      }),

      // oxlint-disable-next-line ren/no-comments -- A35: each key that reaches the workload is an env var that holds its placeholder; a delivered key holds its value (C9). The first owner in the lookup order wins a label. Each connected env item of a reached profile is `LABEL=ren:LABEL` (profiles.md §13 rule 4).
      environment: Effect.fn("Credentials.environment")(function* (
        scope: Scope,
        profileIds: ReadonlyArray<AppProfile.ID>,
      ) {
        const rows = yield* database.db
          .select()
          .from(table)
          .where(and(eq(table.type, "key"), reaches(scope)))
          .pipe(Effect.orDie)
        const ordered = rows.toSorted(
          (left, right) => lookupOrder.indexOf(right.owner) - lookupOrder.indexOf(left.owner),
        )
        const entries = yield* Effect.forEach(ordered, (row) =>
          row.delivery === "egress"
            ? Effect.succeed([[row.label, Credential.placeholder(row.label)]] as const)
            : Effect.map(openRow(row), (value) =>
                Option.isSome(value) && value.value.type === "key"
                  ? ([[row.label, Redacted.value(value.value.value)]] as const)
                  : [],
              ),
        )
        const current = yield* currentOf(scope, profileIds)
        const envLabels = new Set(current.flatMap((entry) => entry.envLabels))
        const connected = envLabels.size
          ? yield* database.db
              .select({ label: table.label })
              .from(table)
              .where(
                and(
                  eq(table.owner, "profile"),
                  inArray(
                    table.profile_id,
                    current.map((entry) => entry.profileId),
                  ),
                  inArray(table.label, [...envLabels]),
                ),
              )
              .pipe(Effect.orDie)
          : []
        return Object.fromEntries([
          ...entries.flat(),
          ...connected.map((row) => [row.label, Credential.placeholder(row.label)] as const),
        ])
      }),

      open: Effect.fn("Credentials.open")(function* (id: Credential.ID) {
        const row = (yield* database.db.select().from(table).where(eq(table.id, id)).pipe(Effect.orDie)).at(0)
        if (!row) return Option.none()
        return Option.map(yield* openRow(row), (value): Opened => ({
          id,
          value,
          revision: row.revision,
          provider: Option.fromNullishOr(row.provider),
          ...(row.expires_at && { expiresAt: DateTime.fromDateUnsafe(row.expires_at) }),
        }))
      }),

      // oxlint-disable-next-line ren/no-comments -- At most one refresh per credential every 5 minutes after a 401, and only for the revision the egress injected (K18).
      // oxlint-disable-next-line ren/no-comments -- README §6.4 rule 3: a connect checks the owner rules before the consent screen.
      authorize: (actor, owner) => checkTarget(actor, owner, "connect"),

      profile: (actor, profileId) => profileOf(actor, profileId),

      claimUnauthorized: Effect.fn("Credentials.claimUnauthorized")(function* (id: Credential.ID, revision: number) {
        const now = yield* Clock.currentTimeMillis
        const claimed = yield* database.db
          .update(table)
          .set({ unauthorized_refresh_at: new Date(now) })
          .where(
            and(
              eq(table.id, id),
              eq(table.revision, revision),
              or(
                isNull(table.unauthorized_refresh_at),
                lt(table.unauthorized_refresh_at, new Date(now - Duration.toMillis(unauthorizedEvery))),
              ),
            ),
          )
          .returning({ id: table.id })
          .pipe(Effect.orDie)
        return claimed.length > 0
      }),

      // oxlint-disable-next-line ren/no-comments -- K47: a 403 insufficient_scope records the scopes the upstream asked for; the next reconnect asks for them too. It changes no status and starts no sign-in.
      addWantedScopes: Effect.fn("Credentials.addWantedScopes")(function* (
        id: Credential.ID,
        scopes: ReadonlyArray<string>,
      ) {
        yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const found = (yield* transaction
                .select({ scopes: table.scopes, wanted: table.wanted_scopes })
                .from(table)
                .where(eq(table.id, id))
                .for("update")).at(0)
              if (!found) return
              const wanted = [...new Set([...found.wanted, ...scopes])]
                .filter((scope) => !found.scopes.includes(scope))
                .slice(0, maximumWantedScopes)
              yield* transaction.update(table).set({ wanted_scopes: wanted }).where(eq(table.id, id))
            }),
          )
          .pipe(Effect.orDie)
      }),

      removeForMember: (organizationId, userId) =>
        offboard((transaction) => CredentialOffboarding.forMember(transaction, organizationId, userId)),
      removeForSpaceMember: (spaceId, userId) =>
        offboard((transaction) => CredentialOffboarding.forSpaceMember(transaction, spaceId, userId)),
      removeForSpace: (spaceId) => offboard((transaction) => CredentialOffboarding.forSpace(transaction, spaceId)),
      removeForProfile: (profileId) =>
        offboard((transaction) => CredentialOffboarding.forProfile(transaction, profileId)),
    })
  }),
)
