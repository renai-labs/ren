export * as Credentials from "./credentials.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Credential } from "@ren/schema/credential"
import type { Space } from "@ren/schema/space"
import type { Workload } from "@ren/schema/workload"
import { and, asc, count, eq, exists, ilike, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Cause, Clock, Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { SqlError } from "effect/sql"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { CredentialOffboarding } from "./credential/offboarding.js"
import { CredentialPolicy } from "./credential/policy.js"
import { EgressControl } from "./egress-control.js"
import { Envelope } from "./envelope.js"
import { Primitive } from "./primitive.js"

export type OwnerKind = Credential.OwnerKind | "workload"

export const lookupOrder: ReadonlyArray<OwnerKind> = ["workload", "person", "space", "org"]

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
  readonly revision?: number | undefined
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
    const byHost = ordered.filter((candidate) => candidate.inject.op !== "replace" && allowsHost(candidate, request))
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
  Schema.Struct({ type: Schema.Literal("route"), upstream: Token, sessionId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("cleared") }),
])
export type Sealed = typeof Sealed.Type

export interface Opened {
  readonly id: Credential.ID
  readonly value: Sealed
  readonly revision: number
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
  readonly candidates: (scope: Scope) => Effect.Effect<ReadonlyArray<Candidate>>
  readonly environment: (scope: Scope) => Effect.Effect<Readonly<Record<string, string>>>
  readonly open: (id: Credential.ID) => Effect.Effect<Option.Option<Opened>>
  readonly authorize: (
    actor: Actor.Info,
    owner: Credential.Owner,
  ) => Effect.Effect<void, Primitive.NotFound | Primitive.Forbidden>
  readonly claimUnauthorized: (id: Credential.ID, revision: number) => Effect.Effect<boolean>
  readonly addWantedScopes: (id: Credential.ID, scopes: ReadonlyArray<string>) => Effect.Effect<void>
  readonly removeForMember: (organizationId: Auth.OrganizationID, userId: Auth.UserID) => Effect.Effect<void>
  readonly removeForSpaceMember: (spaceId: Space.ID, userId: Auth.UserID) => Effect.Effect<void>
  readonly removeForSpace: (spaceId: Space.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Credentials") {}

const table = Database.Schema.credential
const users = Database.Schema.user
const members = Database.Schema.space_member

const notFound = new Primitive.NotFound({ message: "Credential not found." })

const actions = {
  list: Primitive.action(Credential.definition, "list"),
  get: Primitive.action(Credential.definition, "get"),
  create: Primitive.action(Credential.definition, "create"),
  update: Primitive.action(Credential.definition, "update"),
  rotate: Primitive.action(Credential.definition, "rotate"),
  move: Primitive.action(Credential.definition, "move"),
  copy: Primitive.action(Credential.definition, "copy"),
  remove: Primitive.action(Credential.definition, "remove"),
}

const ownerRule = (reason: string, message: string) => new Primitive.Forbidden({ message: `${message} (${reason})` })

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
  return undefined
}

const ownerColumns = (owner: Credential.Owner) => ({
  owner: owner.kind,
  space_id: owner.kind === "space" ? owner.spaceId : null,
  user_id: owner.kind === "person" ? owner.userId : null,
})

const isPasted = (row: { readonly type: Credential.Type; readonly account_user_id: Auth.UserID | null }) =>
  (row.type === "key" || row.type === "basic" || row.type === "fields") && !row.account_user_id

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
            and(eq(members.space_id, table.space_id), eq(members.user_id, actor.userId), isNull(members.archived_at)),
          ),
      )

    const conditions = (actor: Actor.Info): ReadonlyMap<string, SQL | undefined> =>
      new Map([
        [CredentialPolicy.relationships.org, eq(table.owner, "org")],
        [CredentialPolicy.relationships.space, eq(table.owner, "space")],
        [CredentialPolicy.relationships.spaceMember, and(eq(table.owner, "space"), membershipOf(actor))],
        [CredentialPolicy.relationships.self, and(eq(table.owner, "person"), eq(table.user_id, actor.userId))],
        [CredentialPolicy.relationships.person, eq(table.owner, "person")],
      ])

    const visible = (actor: Actor.Info, action: string) => {
      const plan = access.plan(actor, action)
      const where = conditions(actor)
      return and(
        eq(table.organization_id, actor.organizationId),
        ne(table.owner, "workload"),
        or(...plan.allowedWhere.map((relationship) => where.get(relationship))) ?? sql`false`,
      )
    }

    const resourceOf = Effect.fnUntraced(function* (actor: Actor.Info, owner: Credential.Owner) {
      if (owner.kind !== "space")
        return Option.some(CredentialPolicy.resource(owner, { userId: actor.userId, isSpaceMember: false }))
      const spaces = yield* database.db
        .select({ id: Database.Schema.space.id, membershipId: members.id })
        .from(Database.Schema.space)
        .leftJoin(
          members,
          and(
            eq(members.space_id, Database.Schema.space.id),
            eq(members.user_id, actor.userId),
            isNull(members.archived_at),
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
        CredentialPolicy.resource(owner, { userId: actor.userId, isSpaceMember: Boolean(space.membershipId) }),
      )
    })

    const isAllowed = (actor: Actor.Info, action: string, resource: Access.Resource) =>
      access.isAllowed({ actor, action, resource })

    const checkTarget = Effect.fnUntraced(function* (actor: Actor.Info, owner: Credential.Owner, verb: string) {
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

    const checkDelivery = (actor: Actor.Info, owner: Credential.Owner, delivery: Credential.Delivery | undefined) =>
      delivery === "delivered" && owner.kind === "org" && !actor.roles.some(Auth.isAdministrator)
        ? Effect.fail(new Primitive.Forbidden({ message: "Only admins choose delivered for an org credential." }))
        : Effect.void

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
          ),
        )
      if ((counted.at(0)?.total ?? 0) >= Credential.maximumPerOwner)
        return yield* new Primitive.Conflict({
          message: `This owner already has ${Credential.maximumPerOwner} credentials (LimitReached).`,
        })
    })

    const toInfo = (row: typeof table.$inferSelect, accountName: string | null): Credential.Info | undefined => {
      const owner = ownerOf(row)
      if (!owner) return undefined
      return {
        id: row.id,
        organizationId: row.organization_id,
        owner,
        label: row.label,
        name: row.name,
        type: row.type,
        keyPreview: row.key_preview,
        fieldNames: row.field_names,
        hosts: row.hosts,
        inject: row.inject,
        delivery: row.delivery,
        account: row.account_user_id ? { userId: row.account_user_id, name: accountName ?? "" } : null,
        scopes: row.scopes,
        status: row.status,
        app: row.app_id,
        mcp: row.mcp,
        connection: row.connection,
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

    const infoById = Effect.fnUntraced(function* (id: Credential.ID) {
      const found = (yield* selectInfo(eq(table.id, id))).at(0)
      const info = found && toInfo(found.row, found.accountName)
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
              created_by_user_id: actor.userId,
            })
            .pipe(Effect.catchTag("EffectDrizzleQueryError", labelTaken))
        }),
      )
      return yield* infoById(id)
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
          items: rows.flatMap((row) => toInfo(row.row, row.accountName) ?? []),
          page: input.page,
          pageSize: input.pageSize,
          total: totals.at(0)?.total ?? 0,
        }
      }),

      get: Effect.fn("Credentials.get")(function* (actor: Actor.Info, id: string) {
        const found = yield* find(actor, id, actions.get).pipe(
          Effect.catchTag("Primitive.Forbidden", () => Effect.fail(notFound)),
        )
        const info = toInfo(found.row, found.accountName)
        if (!info) return yield* notFound
        return info
      }),

      create: Effect.fn("Credentials.create")(function* (actor: Actor.Info, input: Credential.CreateInput) {
        yield* checkTarget(actor, input.owner, "create")
        yield* checkDelivery(actor, input.owner, input.delivery)
        return yield* insert(actor, input.owner, {
          label: input.label,
          name: input.name ?? null,
          type: input.value.type,
          value: sealedOf(input.value),
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
        return yield* infoById(id)
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
        const sealed = yield* envelope
          .seal(Redacted.make(encodeValue(sealedOf(input.value))), contextOf(found.row.organization_id, id))
          .pipe(Effect.orDie)
        yield* database.db
          .update(table)
          .set({
            value: sealed,
            key_preview: previewOf(sealedOf(input.value)),
            field_names: fieldNamesOf(sealedOf(input.value)),
            status: "ok",
            updated_at: sql`now()`,
          })
          .where(eq(table.id, id))
          .pipe(Effect.orDie)
        yield* removed([found.row.label])
        return yield* infoById(id)
      }),

      move: Effect.fn("Credentials.move")(function* (
        actor: Actor.Info,
        id: Credential.ID,
        input: Credential.MoveInput,
      ) {
        const found = yield* find(actor, id, actions.move)
        const accountUserId = found.row.account_user_id
        if (accountUserId) {
          if (accountUserId !== actor.userId)
            return yield* ownerRule("not_account_holder", "Only the account holder moves an account credential.")
          if (input.owner.kind === "org")
            return yield* ownerRule("account_to_org", "An account credential cannot move to the org.")
          if (input.owner.kind === "person" && input.owner.userId !== actor.userId)
            return yield* ownerRule("not_account_holder", "An account credential moves back only to its holder.")
          if (input.owner.kind === "space") {
            const resource = yield* resourceOf(actor, input.owner)
            if (
              Option.isSome(resource) &&
              !resource.value.relationships.includes(CredentialPolicy.relationships.spaceMember)
            )
              return yield* ownerRule("not_space_member", "Move an account credential only to a space you are in.")
          }
        }
        yield* checkTarget(actor, input.owner, "move")
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
        return yield* infoById(id)
      }),

      copy: Effect.fn("Credentials.copy")(function* (
        actor: Actor.Info,
        id: Credential.ID,
        input: Credential.MoveInput,
      ) {
        const found = yield* find(actor, id, actions.copy)
        if (!isPasted(found.row))
          return yield* ownerRule("copy_rotating", "Only pasted keys can be copied. Move a sign-in instead.")
        yield* checkTarget(actor, input.owner, "copy")
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
        const info = toInfo(found.row, found.accountName)
        if (!info) return yield* notFound
        yield* database.db.delete(table).where(eq(table.id, id)).pipe(Effect.orDie)
        yield* removed([found.row.label])
        return info
      }),

      scopeOf: Effect.fn("Credentials.scopeOf")(function* (workload: Workload.Info) {
        const brainId = workload.kind === "brain" ? workload.id : Brain.ID.make(`brn_${workload.id.slice(4)}`)
        const rows = yield* database.db
          .select({ brain: Database.Schema.brain })
          .from(Database.Schema.brain)
          .where(eq(Database.Schema.brain.id, brainId))
          .pipe(Effect.orDie)
        const brain = rows.at(0)?.brain
        if (!brain) return Option.none()
        const person =
          brain.scope === "session"
            ? Option.fromNullishOr(
                (yield* database.db
                  .select({ userId: Database.Schema.agent_session.created_by })
                  .from(Database.Schema.agent_session)
                  .innerJoin(
                    members,
                    and(
                      eq(members.space_id, Database.Schema.agent_session.space_id),
                      eq(members.user_id, Database.Schema.agent_session.created_by),
                      isNull(members.archived_at),
                    ),
                  )
                  .where(
                    and(
                      eq(Database.Schema.agent_session.brain_id, brain.id),
                      isNull(Database.Schema.agent_session.parent_id),
                    ),
                  )
                  .limit(1)
                  .pipe(Effect.orDie)).at(0)?.userId,
              )
            : Option.none()
        const servesSpace = brain.scope === "space" || Option.isSome(person)
        return Option.some({
          organizationId: brain.organization_id,
          workload,
          spaceId: servesSpace ? Option.some(brain.space_id) : Option.none(),
          person,
        } satisfies Scope)
      }),

      candidates: Effect.fn("Credentials.candidates")(function* (scope: Scope) {
        const rows = yield* database.db
          .select({
            id: table.id,
            label: table.label,
            owner: table.owner,
            hosts: table.hosts,
            inject: table.inject,
            type: table.type,
            revision: table.revision,
            status: table.status,
          })
          .from(table)
          .where(and(eq(table.delivery, "egress"), reaches(scope)))
          .pipe(Effect.orDie)
        return rows.map((row): Candidate => ({
          id: row.id,
          source: "static",
          label: row.label,
          owner: row.owner,
          hosts: row.hosts,
          inject: row.inject,
          type: row.type,
          status: row.status,
          revision: refreshableTypes.includes(row.type) ? row.revision : undefined,
        }))
      }),

      // oxlint-disable-next-line ren/no-comments -- A35: each key that reaches the workload is an env var that holds its placeholder; a delivered key holds its value (C9). The first owner in the lookup order wins a label.
      environment: Effect.fn("Credentials.environment")(function* (scope: Scope) {
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
        return Object.fromEntries(entries.flat())
      }),

      open: Effect.fn("Credentials.open")(function* (id: Credential.ID) {
        const row = (yield* database.db.select().from(table).where(eq(table.id, id)).pipe(Effect.orDie)).at(0)
        if (!row) return Option.none()
        return Option.map(yield* openRow(row), (value): Opened => ({
          id,
          value,
          revision: row.revision,
          ...(row.expires_at && { expiresAt: DateTime.fromDateUnsafe(row.expires_at) }),
        }))
      }),

      // oxlint-disable-next-line ren/no-comments -- At most one refresh per credential every 5 minutes after a 401, and only for the revision the egress injected (K18).
      // oxlint-disable-next-line ren/no-comments -- README §6.4 rule 3: a connect checks the owner rules before the consent screen.
      authorize: (actor, owner) => checkTarget(actor, owner, "connect"),

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
    })
  }),
)
