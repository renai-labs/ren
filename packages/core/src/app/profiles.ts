export * as AppProfiles from "./profiles.js"

import { Database } from "@ren/db/database"
import type { App } from "@ren/schema/app"
import { AppProfile } from "@ren/schema/app-profile"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { Pagination } from "@ren/util/pagination"
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { Credentials } from "../credentials.js"
import { EgressControl } from "../egress-control.js"
import { McpProvider } from "../mcp-provider.js"
import { Primitive } from "../primitive.js"
import { ProfileItems } from "./profile-items.js"
import { AppProfilePolicy } from "./profile-policy.js"
import { AppQueries } from "./queries.js"
import { AppValidation } from "./validation.js"
import { SpacePolicy } from "../space/policy.js"
import { SpaceQueries } from "../space/queries.js"

export interface Reached {
  readonly id: AppProfile.ID
  readonly appId: App.ID
  readonly appSlug: string
  readonly slug: string
  readonly name: string
  readonly kind: AppProfile.Kind
}

export interface Reach {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Option.Option<Space.ID>
}

export interface Interface extends Primitive.Interface<typeof AppProfile.definition> {
  readonly delete: (
    actor: Actor.Info,
    id: AppProfile.ID,
  ) => Effect.Effect<AppProfile.Info, Primitive.NotFound | Primitive.Forbidden>
  readonly reachable: (scope: Reach) => Effect.Effect<ReadonlyArray<Reached>>
  readonly infos: (
    actor: Actor.Info,
    ids: ReadonlyArray<AppProfile.ID>,
  ) => Effect.Effect<ReadonlyArray<AppProfile.Info>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/AppProfiles") {}

const profiles = Database.Schema.app_profile
const listed = Database.Schema.app_profile_space
const links = Database.Schema.app_profile_link
const members = Database.Schema.space_member
const spaces = Database.Schema.space
const spaceGet = Primitive.action(Space.definition, "get")
const credentials = Database.Schema.credential

type Row = typeof profiles.$inferSelect

const notFound = new Primitive.NotFound({ message: "Profile not found." })

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, AppProfile.maximumSlugLength)
    .replace(/-+$/u, "")

const isSlug = Schema.is(AppProfile.Slug)

// oxlint-disable-next-line ren/no-comments -- P13: a custom app's first profile is shared, lists only its owner space, and takes the owner space's name.
export const createOwner = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  input: {
    readonly organizationId: Auth.OrganizationID
    readonly appId: App.ID
    readonly spaceId: Space.ID
    readonly createdBy: Auth.UserID
  },
) {
  const space = (yield* transaction.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, input.spaceId))).at(
    0,
  )
  const name = space?.name ?? "Main"
  const slug = slugify(name)
  const id = AppProfile.ID.create()
  yield* transaction.insert(profiles).values({
    id,
    organization_id: input.organizationId,
    app_id: input.appId,
    slug: isSlug(slug) ? slug : "main",
    name,
    kind: "shared",
    created_by_user_id: input.createdBy,
  })
  yield* transaction.insert(listed).values({ profile_id: id, space_id: input.spaceId })
  return id
})

const listsSpaceOf = (userId: Auth.UserID) =>
  sql`exists (select 1 from ${listed} inner join ${members} on ${members.space_id} = ${listed.space_id} inner join ${spaces} on ${spaces.id} = ${listed.space_id} where ${listed.profile_id} = ${profiles.id} and ${members.user_id} = ${userId} and ${members.archived_at} is null and ${spaces.archived_at} is null)`

const lists = (spaceId: Space.ID) =>
  sql`exists (select 1 from ${listed} where ${listed.profile_id} = ${profiles.id} and ${listed.space_id} = ${spaceId})`

// oxlint-disable-next-line ren/no-comments -- §7 (P44, P45, P8, P11): the one function that decides reach. A one-member space reaches what its person can access; any other space reaches the shared profiles that list it or every space. Links add their profiles, down the chain. An archived app's profiles are not reached. Order: private, then shared, by app slug and profile slug (INV-34).
export const reachable = Effect.fnUntraced(function* (client: Pick<Database.Transaction, "select">, scope: Reach) {
  if (Option.isNone(scope.spaceId)) return []
  const spaceId = scope.spaceId.value
  const people = (yield* client
    .select({ userId: members.user_id })
    .from(members)
    .innerJoin(spaces, eq(spaces.id, members.space_id))
    .where(
      and(
        eq(members.space_id, spaceId),
        eq(spaces.organization_id, scope.organizationId),
        isNull(members.archived_at),
        isNull(spaces.archived_at),
      ),
    )).map((row) => row.userId)
  const person = people.length === 1 ? people.at(0) : undefined
  const direct = yield* client
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.organization_id, scope.organizationId),
        person
          ? or(
              and(eq(profiles.kind, "private"), eq(profiles.user_id, person)),
              and(eq(profiles.kind, "shared"), or(eq(profiles.all_spaces, true), listsSpaceOf(person))),
            )
          : and(eq(profiles.kind, "shared"), or(eq(profiles.all_spaces, true), lists(spaceId))),
      ),
    )
  const found = new Set(direct.map((row) => row.id))
  let pending = [...found]
  while (pending.length) {
    const next = (yield* client
      .select({ id: links.dependency_profile_id })
      .from(links)
      .where(inArray(links.profile_id, pending))).map((row) => row.id)
    pending = [...new Set(next)].filter((id) => !found.has(id))
    for (const id of pending) found.add(id)
  }
  if (!found.size) return []
  const rows = yield* client
    .select({
      id: profiles.id,
      appId: profiles.app_id,
      appSlug: Database.Schema.app.slug,
      slug: profiles.slug,
      name: profiles.name,
      kind: profiles.kind,
    })
    .from(profiles)
    .innerJoin(Database.Schema.app, eq(Database.Schema.app.id, profiles.app_id))
    .where(and(inArray(profiles.id, [...found]), isNull(Database.Schema.app.archived_at)))
    .orderBy(asc(Database.Schema.app.slug), asc(profiles.slug))
  return [...rows.filter((row) => row.kind === "private"), ...rows.filter((row) => row.kind === "shared")]
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const store = yield* Credentials.Service
    const control = yield* EgressControl.Service
    const registry = yield* McpProvider.Registry

    const spacesOf = Effect.fnUntraced(function* (client: Pick<Database.Transaction, "select">, actor: Actor.Info) {
      return (yield* client
        .select({ id: spaces.id })
        .from(members)
        .innerJoin(spaces, eq(spaces.id, members.space_id))
        .where(
          and(
            eq(members.user_id, actor.userId),
            eq(spaces.organization_id, actor.organizationId),
            isNull(members.archived_at),
            isNull(spaces.archived_at),
          ),
        )).map((row) => row.id)
    })

    const listedOf = Effect.fnUntraced(function* (
      client: Pick<Database.Transaction, "select">,
      actor: Actor.Info,
      ids: ReadonlyArray<AppProfile.ID>,
    ) {
      if (!ids.length)
        return new Map<
          AppProfile.ID,
          ReadonlyArray<{ id: Space.ID; name: string; membershipId: Space.MembershipID | null }>
        >()
      const rows = yield* client
        .select({
          profileId: listed.profile_id,
          id: spaces.id,
          name: spaces.name,
          membershipId: SpaceQueries.membership.id,
        })
        .from(listed)
        .innerJoin(spaces, and(eq(spaces.id, listed.space_id), isNull(spaces.archived_at)))
        .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
        .where(inArray(listed.profile_id, [...ids]))
        .orderBy(asc(spaces.name), asc(spaces.id))
      const grouped = Map.groupBy(rows, (row) => row.profileId)
      return new Map(ids.map((id) => [id, grouped.get(id) ?? []]))
    })

    const holdsOf = (
      actor: Actor.Info,
      row: Row,
      spacesListed: ReadonlyArray<{ readonly membershipId: Space.MembershipID | null }>,
    ): AppProfilePolicy.Holds => ({
      kind: row.kind,
      isCreator: row.created_by_user_id === actor.userId,
      isListedMember: spacesListed.some((space) => space.membershipId !== null),
      allSpaces: row.all_spaces,
      isSelf: row.user_id === actor.userId,
    })

    const allowed = (actor: Actor.Info, action: string, holds: AppProfilePolicy.Holds) =>
      access.isAllowed({ actor, action, resource: AppProfilePolicy.resource(holds) })

    const isProviderSetUp = Effect.fnUntraced(function* (provider: string) {
      return Option.isSome(yield* Effect.option(registry.get(provider)))
    })

    // oxlint-disable-next-line ren/no-comments -- connections.md K28: a provider account that is no longer active needs a reconnect; Ren records it and drops the egress answers that used it.
    const health = Effect.fnUntraced(function* (row: typeof credentials.$inferSelect) {
      if (row.type !== "route" || !row.provider || !row.provider_account_id) return "ok" as const
      const provider = yield* Effect.option(registry.get(row.provider))
      if (Option.isNone(provider)) return "ok" as const
      const status = yield* Effect.option(provider.value.status(row.provider_account_id))
      if (Option.isNone(status) || status.value === "active") return "ok" as const
      yield* database.db
        .update(credentials)
        .set({ status: "reconnect" })
        .where(eq(credentials.id, row.id))
        .pipe(Effect.orDie)
      yield* control.invalidate({ label: row.label })
      return "reconnect" as const
    })

    const infos = Effect.fnUntraced(function* (
      client: Pick<Database.Transaction, "select">,
      actor: Actor.Info,
      rows: ReadonlyArray<Row>,
    ) {
      if (!rows.length) return []
      const ids = rows.map((row) => row.id)
      const apps = new Map(
        (yield* client
          .select()
          .from(Database.Schema.app)
          .where(
            inArray(
              Database.Schema.app.id,
              rows.map((row) => row.app_id),
            ),
          )).map((app) => [app.id, app]),
      )
      const spacesListed = yield* listedOf(client, actor, ids)
      const credentialRows = Map.groupBy(
        yield* client
          .select({ row: credentials, holder: Database.Schema.user.name })
          .from(credentials)
          .leftJoin(Database.Schema.user, eq(Database.Schema.user.id, credentials.account_user_id))
          .where(and(eq(credentials.owner, "profile"), inArray(credentials.profile_id, ids))),
        (entry) => entry.row.profile_id,
      )
      const linkRows = Map.groupBy(
        yield* client.select().from(links).where(inArray(links.profile_id, ids)),
        (link) => link.profile_id,
      )
      const dependencies = Map.groupBy(
        yield* client
          .select({ appId: Database.Schema.app_dependency.app_id, dependency: Database.Schema.app })
          .from(Database.Schema.app_dependency)
          .innerJoin(Database.Schema.app, eq(Database.Schema.app.id, Database.Schema.app_dependency.dependency_app_id))
          .where(
            inArray(
              Database.Schema.app_dependency.app_id,
              rows.map((row) => row.app_id),
            ),
          )
          .orderBy(asc(Database.Schema.app.slug)),
        (edge) => edge.appId,
      )
      const configured = new Set(
        (yield* client
          .select({ name: Database.Schema.oauth_app.name })
          .from(Database.Schema.oauth_app)
          .where(
            and(
              eq(Database.Schema.oauth_app.organization_id, actor.organizationId),
              isNull(Database.Schema.oauth_app.archived_at),
            ),
          )).map((row) => row.name),
      )
      const claims = yield* AppValidation.claims(client, actor.organizationId)
      return yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const app = apps.get(row.app_id)
          if (!app) return yield* Effect.die(new Error(`Profile ${row.id} has no app`))
          const declared = ProfileItems.declared(
            { mcps: app.mcps, skills: app.skills, requiredCredentials: app.required_credentials },
            row.slug,
          )
          const own = credentialRows.get(row.id) ?? []
          const byLabel = new Map(own.map((entry) => [entry.row.label, entry]))
          const items = yield* Effect.forEach(declared, (item) =>
            Effect.gen(function* () {
              const found = byLabel.get(item.label)
              const transport = item.mcp?.transport
              const declared = ProfileItems.statusOf(item, found?.row, {
                isProviderSetUp: transport?.type === "provider" ? yield* isProviderSetUp(transport.provider) : true,
              })
              const status = found && declared === "ok" ? yield* health(found.row) : declared
              return {
                item: item.item,
                kind: item.kind,
                label: item.label,
                name: item.name,
                status,
                optional: item.optional,
                credentialId: found?.row.id ?? null,
                holder: found?.row.account_user_id
                  ? { userId: found.row.account_user_id, name: found.holder ?? "" }
                  : null,
              } satisfies AppProfile.Item
            }),
          )
          const labels = new Set(declared.map((item) => item.label))
          const visible = spacesListed.get(row.id) ?? []
          const shown = visible.filter((space) =>
            access.isAllowed({ actor, action: spaceGet, resource: SpacePolicy.resource(space.membershipId, space.id) }),
          )
          return {
            id: row.id,
            appId: row.app_id,
            appSlug: app.slug,
            slug: row.slug,
            name: row.name,
            kind: row.kind,
            userId: row.user_id,
            allSpaces: row.all_spaces,
            spaces: shown.map((space) => ({ id: space.id, name: space.name })),
            hiddenSpaces: visible.length - shown.length,
            canAccess: allowed(actor, AppProfilePolicy.actions.access, holdsOf(actor, row, visible)),
            canShareEverySpace: allowed(actor, AppProfilePolicy.actions.shareEverySpace, holdsOf(actor, row, visible)),
            links: (dependencies.get(row.app_id) ?? [])
              .filter(
                (edge) =>
                  ProfileItems.declared(
                    {
                      mcps: edge.dependency.mcps,
                      skills: edge.dependency.skills,
                      requiredCredentials: edge.dependency.required_credentials,
                    },
                    row.slug,
                  ).length > 0,
              )
              .map((edge) => ({
                appId: edge.dependency.id,
                profileId:
                  (linkRows.get(row.id) ?? []).find((link) => link.dependency_app_id === edge.dependency.id)
                    ?.dependency_profile_id ?? null,
              })),
            items,
            unused: own
              .filter((entry) => !labels.has(entry.row.label))
              .map((entry) => ({ credentialId: entry.row.id, label: entry.row.label })),
            oauthApps: ProfileItems.oauthApps({ mcps: app.mcps, requiredCredentials: app.required_credentials }).map(
              (name) => ({ name, isConfigured: configured.has(name) }),
            ),
            skipped: claims.skipped.get(row.app_id) ?? [],
            createdBy: row.created_by_user_id,
            createdAt: DateTime.fromDateUnsafe(row.created_at),
            updatedAt: DateTime.fromDateUnsafe(row.updated_at),
          } satisfies AppProfile.Info
        }),
      )
    })

    const visibleRows = Effect.fnUntraced(function* (
      client: Pick<Database.Transaction, "select">,
      actor: Actor.Info,
      action: string,
      where: ReturnType<typeof and>,
    ) {
      const rows = yield* client
        .select({ profile: profiles, appSlug: Database.Schema.app.slug })
        .from(profiles)
        .innerJoin(Database.Schema.app, eq(Database.Schema.app.id, profiles.app_id))
        .where(and(eq(profiles.organization_id, actor.organizationId), where))
        .orderBy(asc(Database.Schema.app.slug), asc(profiles.slug))
      const spacesListed = yield* listedOf(
        client,
        actor,
        rows.map((row) => row.profile.id),
      )
      return rows
        .map((row) => row.profile)
        .filter((row) => allowed(actor, action, holdsOf(actor, row, spacesListed.get(row.id) ?? [])))
    })

    const find = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: string,
      action: string,
    ) {
      if (!Schema.is(AppProfile.ID)(id)) return yield* notFound
      const row = (yield* transaction
        .select()
        .from(profiles)
        .where(and(eq(profiles.id, id), eq(profiles.organization_id, actor.organizationId)))
        .for("update")).at(0)
      if (!row) return yield* notFound
      const holds = holdsOf(actor, row, (yield* listedOf(transaction, actor, [row.id])).get(row.id) ?? [])
      if (!allowed(actor, AppProfilePolicy.actions.get, holds)) return yield* notFound
      if (!allowed(actor, action, holds))
        return yield* new Primitive.Forbidden({ message: "You cannot change this profile." })
      return row
    })

    const infoOf = Effect.fnUntraced(function* (
      client: Pick<Database.Transaction, "select">,
      actor: Actor.Info,
      id: AppProfile.ID,
    ) {
      const row = (yield* client.select().from(profiles).where(eq(profiles.id, id))).at(0)
      const info = row && (yield* infos(client, actor, [row])).at(0)
      if (!info) return yield* notFound
      return info
    })

    // oxlint-disable-next-line ren/no-comments -- §11: a reach change drops the egress answers for the labels of the profile's items, and those of the profiles it links to, connected or not.
    const labelsOf = Effect.fnUntraced(function* (client: Pick<Database.Transaction, "select">, id: AppProfile.ID) {
      const found = new Set([id])
      let pending = [id]
      while (pending.length) {
        const next = (yield* client
          .select({ id: links.dependency_profile_id })
          .from(links)
          .where(inArray(links.profile_id, pending))).map((row) => row.id)
        pending = [...new Set(next)].filter((linked) => !found.has(linked))
        for (const linked of pending) found.add(linked)
      }
      const rows = yield* client
        .select({ slug: profiles.slug, app: Database.Schema.app })
        .from(profiles)
        .innerJoin(Database.Schema.app, eq(Database.Schema.app.id, profiles.app_id))
        .where(inArray(profiles.id, [...found]))
      const owned = yield* client
        .select({ label: credentials.label })
        .from(credentials)
        .where(and(eq(credentials.owner, "profile"), inArray(credentials.profile_id, [...found])))
      return [
        ...rows.flatMap((row) =>
          ProfileItems.declared(
            { mcps: row.app.mcps, skills: row.app.skills, requiredCredentials: row.app.required_credentials },
            row.slug,
          ).map((item) => item.label),
        ),
        ...owned.map((row) => row.label),
      ]
    })

    const invalidate = (labels: ReadonlyArray<string>) =>
      Effect.forEach([...new Set(labels)], (label) => control.invalidate({ label }), { discard: true })

    const checkSpaces = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      ids: ReadonlyArray<Space.ID>,
    ) {
      if (!ids.length) return
      const known = yield* transaction
        .select({ id: spaces.id, membershipId: SpaceQueries.membership.id })
        .from(spaces)
        .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
        .where(
          and(
            inArray(spaces.id, [...ids]),
            eq(spaces.organization_id, actor.organizationId),
            isNull(spaces.archived_at),
          ),
        )
      if (ids.some((id) => !known.some((space) => space.id === id)))
        return yield* new Primitive.NotFound({ message: "Space not found." })
      if (
        !known.every((space) =>
          access.isAllowed({
            actor,
            action: AppProfilePolicy.actions.listInSpace,
            resource: SpacePolicy.resource(space.membershipId, space.id),
          }),
        )
      )
        return yield* new Primitive.Forbidden({ message: "You cannot list a profile in this space (P19)." })
    })

    // oxlint-disable-next-line ren/no-comments -- P20: a private profile lists no spaces; only admins choose every space; a member's new shared profile lists the member's spaces unless they name some.
    const listOf = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      input: AppProfile.CreateInput,
    ) {
      if (input.kind === "private") {
        if (input.allSpaces || input.spaceIds?.length)
          return yield* new Primitive.Invalid({ message: "A private profile lists no spaces.", field: "spaceIds" })
        return []
      }
      if (
        input.allSpaces &&
        !allowed(actor, AppProfilePolicy.actions.shareEverySpace, { ...holdsNone, kind: input.kind })
      )
        return yield* new Primitive.Forbidden({ message: "You cannot share a profile with every space (P20)." })
      const spaceIds = input.spaceIds ?? (input.allSpaces ? [] : yield* spacesOf(transaction, actor))
      yield* checkSpaces(transaction, actor, spaceIds)
      return spaceIds
    })

    // oxlint-disable-next-line ren/no-comments -- §9 rule 10 (P8): a link names a profile of a dependency app. A shared profile links shared profiles only; a private profile also links the person's own private profiles.
    const checkLink = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      row: Row,
      link: { readonly appId: App.ID; readonly profileId: AppProfile.ID },
    ) {
      const edge = (yield* transaction
        .select()
        .from(Database.Schema.app_dependency)
        .where(
          and(
            eq(Database.Schema.app_dependency.app_id, row.app_id),
            eq(Database.Schema.app_dependency.dependency_app_id, link.appId),
          ),
        )).at(0)
      if (!edge) return yield* new Primitive.NotFound({ message: "The app does not depend on this app." })
      const target = (yield* transaction
        .select()
        .from(profiles)
        .where(
          and(
            eq(profiles.id, link.profileId),
            eq(profiles.app_id, link.appId),
            eq(profiles.organization_id, actor.organizationId),
          ),
        )).at(0)
      if (!target) return yield* notFound
      const holds = holdsOf(actor, target, (yield* listedOf(transaction, actor, [target.id])).get(target.id) ?? [])
      if (target.kind === "private" && (row.kind === "shared" || target.user_id !== row.user_id))
        return yield* new Primitive.Forbidden({ message: "A shared profile cannot link a private profile." })
      if (!allowed(actor, AppProfilePolicy.actions.get, holds)) return yield* notFound
    })

    const writeLink = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      profileId: AppProfile.ID,
      link: { readonly appId: App.ID; readonly profileId: AppProfile.ID | null },
    ) {
      yield* transaction
        .delete(links)
        .where(and(eq(links.profile_id, profileId), eq(links.dependency_app_id, link.appId)))
      if (link.profileId)
        yield* transaction
          .insert(links)
          .values({ profile_id: profileId, dependency_app_id: link.appId, dependency_profile_id: link.profileId })
    })

    const touch = (transaction: Database.Transaction, id: AppProfile.ID) =>
      transaction
        .update(profiles)
        .set({ updated_at: sql`now()` })
        .where(eq(profiles.id, id))

    return Service.of({
      list: Effect.fn("AppProfiles.list")(function* (actor, input) {
        return yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const reached = input.spaceId
                ? (yield* reachable(transaction, {
                    organizationId: actor.organizationId,
                    spaceId: Option.some(input.spaceId),
                  })).map((row) => row.id)
                : undefined
              if (reached && !reached.length) return Pagination.page([], input)
              const rows = yield* visibleRows(
                transaction,
                actor,
                AppProfilePolicy.actions.list,
                and(
                  input.appId ? eq(profiles.app_id, input.appId) : undefined,
                  reached ? inArray(profiles.id, reached) : undefined,
                ),
              )
              const page = Pagination.page(rows, input)
              return { ...page, items: yield* infos(transaction, actor, page.items) }
            }),
          )
          .pipe(Effect.orDie)
      }),

      get: Effect.fn("AppProfiles.get")(function* (actor, id) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, AppProfilePolicy.actions.get).pipe(
              Effect.catchTag("Primitive.Forbidden", () => Effect.fail(notFound)),
            )
            return yield* infoOf(transaction, actor, row.id)
          }),
        )
      }),

      infos: Effect.fn("AppProfiles.infos")(function* (actor, ids) {
        if (!ids.length) return []
        return yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const rows = yield* visibleRows(
                transaction,
                actor,
                AppProfilePolicy.actions.get,
                inArray(profiles.id, [...ids]),
              )
              const found = yield* infos(transaction, actor, rows)
              return ids.flatMap((id) => found.filter((info) => info.id === id))
            }),
          )
          .pipe(Effect.orDie)
      }),

      create: Effect.fn("AppProfiles.create")(function* (actor, input) {
        const created = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const found = yield* AppQueries.find(transaction, access, actor, input.appId)
            if (!found.app.organization_id && !found.isListed)
              return yield* new Primitive.Conflict({ message: "This app is withdrawn; it takes no new profiles." })
            if (!allowed(actor, AppProfilePolicy.actions.create, { ...holdsNone, kind: input.kind }))
              return yield* new Primitive.Forbidden({ message: "You cannot create profiles." })
            const isPrivate = input.kind === "private"
            const spaceIds = yield* listOf(transaction, actor, input)
            const first = (yield* transaction
              .select({ id: profiles.id })
              .from(profiles)
              .where(and(eq(profiles.organization_id, actor.organizationId), eq(profiles.app_id, input.appId)))
              .limit(1)).at(0)
            const id = AppProfile.ID.create()
            yield* transaction
              .insert(profiles)
              .values({
                id,
                organization_id: actor.organizationId,
                app_id: input.appId,
                slug: input.slug,
                name: input.name,
                kind: input.kind,
                user_id: isPrivate ? actor.userId : null,
                all_spaces: input.allSpaces ?? false,
                created_by_user_id: actor.userId,
              })
              .pipe(
                Effect.catchTag(
                  "EffectDrizzleQueryError",
                  Primitive.uniqueConflict(
                    Database.Schema.appProfileSlugConstraint,
                    `A profile with the slug “${input.slug}” already exists in this app.`,
                  ),
                ),
              )
            if (spaceIds.length)
              yield* transaction.insert(listed).values(spaceIds.map((space_id) => ({ profile_id: id, space_id })))
            if (!first)
              yield* AppValidation.names(transaction, actor.organizationId, [
                {
                  row: found.app,
                  dependsOn: (yield* transaction
                    .select({ id: Database.Schema.app_dependency.dependency_app_id })
                    .from(Database.Schema.app_dependency)
                    .where(eq(Database.Schema.app_dependency.app_id, found.app.id))).map((edge) => edge.id),
                },
              ])
            const row = (yield* transaction.select().from(profiles).where(eq(profiles.id, id))).at(0)
            if (!row) return yield* Effect.die(new Error("Profile insert returned no row"))
            yield* Effect.forEach(input.links ?? [], (link) =>
              checkLink(transaction, actor, row, link).pipe(Effect.andThen(writeLink(transaction, id, link))),
            )
            return { info: yield* infoOf(transaction, actor, id), labels: yield* labelsOf(transaction, id) }
          }),
        )
        yield* invalidate(created.labels)
        return created.info
      }),

      update: Effect.fn("AppProfiles.update")(function* (actor, id, input) {
        const changed = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, AppProfilePolicy.actions.update)
            if (input.name)
              yield* transaction
                .update(profiles)
                .set({ name: input.name, updated_at: sql`now()` })
                .where(eq(profiles.id, row.id))
            return { info: yield* infoOf(transaction, actor, row.id), labels: yield* labelsOf(transaction, row.id) }
          }),
        )
        yield* invalidate(changed.labels)
        return changed.info
      }),

      delete: Effect.fn("AppProfiles.delete")(function* (actor, id) {
        const deleted = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, AppProfilePolicy.actions.delete)
            const info = yield* infoOf(transaction, actor, row.id)
            const labels = yield* labelsOf(transaction, row.id)
            return { info, labels }
          }),
        )
        yield* store.removeForProfile(deleted.info.id)
        yield* database.db.delete(profiles).where(eq(profiles.id, deleted.info.id)).pipe(Effect.orDie)
        yield* invalidate(deleted.labels)
        return deleted.info
      }),

      access: Effect.fn("AppProfiles.access")(function* (actor, id, input) {
        const changed = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, AppProfilePolicy.actions.access)
            if (row.kind === "private")
              return yield* new Primitive.Forbidden({ message: "A private profile lists no spaces." })
            if (
              typeof input.allSpaces === "boolean" &&
              !allowed(actor, AppProfilePolicy.actions.shareEverySpace, { ...holdsNone, kind: row.kind })
            )
              return yield* new Primitive.Forbidden({ message: "You cannot share a profile with every space (P20)." })
            const add = input.add ?? []
            const remove = input.remove ?? []
            yield* checkSpaces(transaction, actor, [...add, ...remove])
            if (add.length)
              yield* transaction
                .insert(listed)
                .values(add.map((space_id) => ({ profile_id: row.id, space_id })))
                .onConflictDoNothing()
            if (remove.length)
              yield* transaction
                .delete(listed)
                .where(and(eq(listed.profile_id, row.id), inArray(listed.space_id, [...remove])))
            if (typeof input.allSpaces === "boolean")
              yield* transaction.update(profiles).set({ all_spaces: input.allSpaces }).where(eq(profiles.id, row.id))
            yield* touch(transaction, row.id)
            const left = yield* transaction
              .select({ space: listed.space_id })
              .from(listed)
              .where(eq(listed.profile_id, row.id))
            return {
              info: yield* infoOf(transaction, actor, row.id),
              labels: yield* labelsOf(transaction, row.id),
              unused: unusedAfter(input, { allSpaces: row.all_spaces, left: left.length }),
            }
          }),
        )
        // oxlint-disable-next-line ren/no-comments -- A shared profile that no space uses any more is deleted, with its sign-ins, as a delete does.
        if (changed.unused) {
          yield* store.removeForProfile(changed.info.id)
          yield* database.db.delete(profiles).where(eq(profiles.id, changed.info.id)).pipe(Effect.orDie)
        }
        yield* invalidate(changed.labels)
        return changed.info
      }),

      link: Effect.fn("AppProfiles.link")(function* (actor, id, input) {
        const changed = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, AppProfilePolicy.actions.link)
            const before = yield* labelsOf(transaction, row.id)
            if (input.profileId)
              yield* checkLink(transaction, actor, row, { appId: input.appId, profileId: input.profileId })
            yield* writeLink(transaction, row.id, input)
            yield* touch(transaction, row.id)
            return { info: yield* infoOf(transaction, actor, row.id), labels: before }
          }),
        )
        yield* invalidate(changed.labels)
        return changed.info
      }),

      promote: Effect.fn("AppProfiles.promote")(function* (actor, id) {
        const changed = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, AppProfilePolicy.actions.promote)
            if (row.kind !== "private") return yield* new Primitive.Conflict({ message: "The profile is shared." })
            yield* transaction
              .update(profiles)
              .set({ kind: "shared", user_id: null, updated_at: sql`now()` })
              .where(eq(profiles.id, row.id))
            const own = yield* spacesOf(transaction, actor)
            if (own.length)
              yield* transaction
                .insert(listed)
                .values(own.map((space_id) => ({ profile_id: row.id, space_id })))
                .onConflictDoNothing()
            return {
              info: yield* infoOf(transaction, actor, row.id),
              labels: yield* labelsOf(transaction, row.id),
            }
          }),
        )
        yield* invalidate(changed.labels)
        return changed.info
      }),

      reachable: Effect.fn("AppProfiles.reachable")(function* (scope) {
        return yield* reachable(database.db, scope).pipe(Effect.orDie)
      }),
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- An access change that took away the last space of a shared profile that is not for every space.
const unusedAfter = (input: AppProfile.AccessInput, before: { readonly allSpaces: boolean; readonly left: number }) =>
  ((input.remove?.length ?? 0) > 0 || input.allSpaces === false) &&
  !(input.allSpaces ?? before.allSpaces) &&
  before.left === 0

const holdsNone = { isCreator: false, isListedMember: false, allSpaces: false, isSelf: false }
