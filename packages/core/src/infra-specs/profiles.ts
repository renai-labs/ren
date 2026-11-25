export * as InfraProfiles from "./profiles.js"

import { Database } from "@ren/db/database"
import type { AppProfile } from "@ren/schema/app-profile"
import type { Auth } from "@ren/schema/auth"
import type { Infra } from "@ren/schema/infra"
import type { Space } from "@ren/schema/space"
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm"
import { Effect, Predicate } from "effect"
import { App } from "../app.js"
import { AppProfiles } from "../app/profiles.js"
import { AppQueries } from "../app/queries.js"
import { InfraPlan } from "./plan.js"

export interface LiveProfile {
  readonly id: AppProfile.ID
  readonly appSlug: string
  readonly slug: string
  readonly name: string
  readonly allSpaces: boolean
  readonly spaces: ReadonlyArray<Space.ID>
}

export interface Live {
  readonly profiles: ReadonlyArray<LiveProfile>
  readonly private: ReadonlyArray<{ readonly appSlug: string; readonly slug: string }>
  readonly apps: ReadonlyArray<{ readonly slug: string; readonly isWithdrawn: boolean }>
}

export type Catalogue = Readonly<Record<string, Readonly<Record<string, Infra.ProfileDeclaration>>>>

export const path = (space: string, app: string, profile: string) =>
  `deploy.yaml/spaces/${space}/profiles/${app}/${profile}`

export const declaredPath = (app: string, profile: string) => `deploy.yaml/profiles/${app}/${profile}`

export const canonical = (declaration: Infra.ProfileDeclaration) => ({
  name: declaration.name,
  ...(declaration.allSpaces && { allSpaces: true }),
})

export const load = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  declared: ReadonlyArray<string>,
) {
  const rows = yield* transaction
    .select({
      id: Database.Schema.app_profile.id,
      appSlug: Database.Schema.app.slug,
      slug: Database.Schema.app_profile.slug,
      name: Database.Schema.app_profile.name,
      kind: Database.Schema.app_profile.kind,
      allSpaces: Database.Schema.app_profile.all_spaces,
    })
    .from(Database.Schema.app_profile)
    .innerJoin(Database.Schema.app, eq(Database.Schema.app.id, Database.Schema.app_profile.app_id))
    .where(
      and(
        eq(Database.Schema.app_profile.organization_id, organizationId),
        isNull(Database.Schema.app.archived_at),
        declared.length === 0
          ? eq(Database.Schema.app_profile.kind, "shared")
          : or(eq(Database.Schema.app_profile.kind, "shared"), inArray(Database.Schema.app.slug, [...declared])),
      ),
    )
    .orderBy(asc(Database.Schema.app.slug), asc(Database.Schema.app_profile.slug))
  const shared = rows.filter((row) => row.kind === "shared")
  const listings =
    shared.length === 0
      ? []
      : yield* transaction
          .select({
            profileId: Database.Schema.app_profile_space.profile_id,
            spaceId: Database.Schema.app_profile_space.space_id,
          })
          .from(Database.Schema.app_profile_space)
          .where(
            inArray(
              Database.Schema.app_profile_space.profile_id,
              shared.map((row) => row.id),
            ),
          )
          .orderBy(asc(Database.Schema.app_profile_space.profile_id), asc(Database.Schema.app_profile_space.space_id))
  const apps =
    declared.length === 0
      ? []
      : yield* transaction
          .select({
            slug: Database.Schema.app.slug,
            organizationId: Database.Schema.app.organization_id,
            isListed: AppQueries.isListed,
          })
          .from(Database.Schema.app)
          .where(
            and(
              inArray(Database.Schema.app.slug, [...declared]),
              isNull(Database.Schema.app.archived_at),
              or(eq(Database.Schema.app.organization_id, organizationId), isNull(Database.Schema.app.organization_id)),
            ),
          )
  const spaces = Map.groupBy(listings, (listing) => listing.profileId)
  return {
    profiles: shared.map((row) => ({
      id: row.id,
      appSlug: row.appSlug,
      slug: row.slug,
      name: row.name,
      allSpaces: row.allSpaces,
      spaces: (spaces.get(row.id) ?? []).map((listing) => listing.spaceId),
    })),
    private: rows.filter((row) => row.kind === "private").map((row) => ({ appSlug: row.appSlug, slug: row.slug })),
    apps: apps.map((app) => ({ slug: app.slug, isWithdrawn: !app.organizationId && !app.isListed })),
  } satisfies Live
})

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const apps = yield* App.Service
  const profiles = yield* AppProfiles.Service

  const diff = (context: InfraPlan.Context, live: Live, catalogue: Catalogue): InfraPlan.Planned => {
    const problems: Array<Infra.Problem> = []
    const byApp = Map.groupBy(live.profiles, (profile) => profile.appSlug)
    const liveOf = (app: string, slug: string) => (byApp.get(app) ?? []).find((profile) => profile.slug === slug)
    const isShared = (app: string, slug: string) => {
      const declaration = catalogue[app]?.[slug]
      return declaration ? declaration.allSpaces === true : liveOf(app, slug)?.allSpaces === true
    }
    const listers = (app: string, slug: string) =>
      context.spaces.filter((space) => (space.bindings?.profiles[app] ?? []).includes(slug))
    const bound = (app: string) =>
      new Set(context.spaces.flatMap((space) => (space.bindings?.profiles[app] && space.liveId ? [space.liveId] : [])))
    const declared = Object.entries(catalogue).flatMap(([app, entries]) =>
      Object.entries(entries).map(([slug, declaration]) => ({
        app,
        slug,
        declaration,
        live: liveOf(app, slug),
        target: declaredPath(app, slug),
      })),
    )
    const pairs = context.spaces.flatMap((space) =>
      Object.entries(space.bindings?.profiles ?? {}).map(([app, slugs]) => ({
        space,
        app,
        slugs: [...new Set(slugs)],
        live: (byApp.get(app) ?? []).filter((profile) => !isShared(app, profile.slug)),
      })),
    )

    const adds = pairs.flatMap((pair) =>
      pair.slugs.flatMap((slug) => {
        const target = path(pair.space.slug, pair.app, slug)
        const profile = liveOf(pair.app, slug)
        if (!profile && !catalogue[pair.app]?.[slug]) {
          problems.push({
            path: target,
            message: `Declare the shared profile ${slug} of ${pair.app} under profiles in deploy.yaml, or create it in Ren.`,
          })
          return []
        }
        if (isShared(pair.app, slug)) {
          problems.push({
            path: target,
            message: `Profile ${slug} of ${pair.app} is shared with every space. Remove it from deploy.yaml.`,
          })
          return []
        }
        const liveId = pair.space.liveId
        if (!profile || (liveId && profile.spaces.includes(liveId))) return []
        return [{ space: pair.space, profile, target }]
      }),
    )

    const candidates = pairs.flatMap((pair) => {
      const liveId = pair.space.liveId
      if (!liveId) return []
      return pair.live
        .filter((profile) => profile.spaces.includes(liveId) && !pair.slugs.includes(profile.slug))
        .map((profile) => ({
          space: pair.space,
          liveId,
          profile,
          target: path(pair.space.slug, pair.app, profile.slug),
        }))
    })
    const removed = Map.groupBy(candidates, (candidate) => candidate.profile.id)
    const added = new Set(adds.map((add) => add.profile.id))
    const removals = candidates.filter((candidate) => {
      const gone = new Set((removed.get(candidate.profile.id) ?? []).map((other) => other.liveId))
      if (added.has(candidate.profile.id) || candidate.profile.spaces.some((space) => !gone.has(space))) return true
      problems.push({
        path: candidate.target,
        message: `No other space lists profile ${candidate.profile.slug} of ${candidate.profile.appSlug}, so removing it would delete the profile and its credentials. Infra never deletes a profile: keep it listed, or delete it in the app.`,
      })
      return false
    })

    const inSpec = new Set(context.spaces.flatMap((space) => Object.keys(space.declaration.apps)))
    const reached = new Map(live.apps.map((app) => [app.slug, app]))
    const owned = new Set(live.private.map((profile) => `${profile.appSlug}/${profile.slug}`))
    const creates = declared.filter((entry) => {
      if (entry.live) return false
      const app = reached.get(entry.app)
      problems.push(
        ...[
          owned.has(`${entry.app}/${entry.slug}`) &&
            `Profile ${entry.slug} of ${entry.app} is a private profile, and infra manages shared profiles only. Choose another slug.`,
          app?.isWithdrawn && `App ${entry.app} is withdrawn from the registry, so it takes no new profiles.`,
          !app && !inSpec.has(entry.app) && `App ${entry.app} is not in this organization or the registry.`,
        ]
          .filter(Predicate.isString)
          .slice(0, 1)
          .map((message) => ({ path: entry.target, message })),
      )
      return true
    })
    const updates = declared.flatMap((entry) => {
      const current = entry.live
      if (!current) return []
      const allSpaces = entry.declaration.allSpaces === true
      const fields = InfraPlan.changed({
        name: current.name !== entry.declaration.name,
        allSpaces: current.allSpaces !== allSpaces,
      })
      if (fields.length === 0) return []
      const others = bound(entry.app)
      if (
        current.allSpaces &&
        !allSpaces &&
        listers(entry.app, entry.slug).length === 0 &&
        current.spaces.every((space) => others.has(space))
      )
        problems.push({
          path: entry.target,
          message: `No space lists profile ${entry.slug} of ${entry.app}, so turning off allSpaces would delete it and its credentials. List it on a space first.`,
        })
      return [{ ...entry, current, allSpaces, fields }]
    })

    const reach = (app: string, slug: string, current: LiveProfile | undefined) => {
      const others = bound(app)
      return isShared(app, slug)
        ? ("every" as const)
        : new Set([
            ...(current?.spaces ?? [])
              .filter((space) => !others.has(space))
              .map((space) => context.slugOf(space) ?? space),
            ...listers(app, slug).map((space) => space.slug),
          ])
    }
    const nameOf = (app: string, profile: LiveProfile) => catalogue[app]?.[profile.slug]?.name ?? profile.name
    const changing = [
      ...creates.map((entry) => ({ app: entry.app, slug: entry.slug, target: entry.target })),
      ...updates.map((entry) => ({ app: entry.app, slug: entry.slug, target: entry.target })),
      ...adds.map((add) => ({ app: add.profile.appSlug, slug: add.profile.slug, target: add.target })),
    ]
    problems.push(
      ...[...new Map(changing.map((entry) => [`${entry.app}/${entry.slug}`, entry])).values()].flatMap((entry) => {
        const own = reach(entry.app, entry.slug, liveOf(entry.app, entry.slug))
        const name = (catalogue[entry.app]?.[entry.slug]?.name ?? liveOf(entry.app, entry.slug)?.name ?? "")
          .trim()
          .toLowerCase()
        const clash = [
          ...(byApp.get(entry.app) ?? []).map((profile) => ({
            slug: profile.slug,
            name: nameOf(entry.app, profile),
            reach: reach(entry.app, profile.slug, profile),
          })),
          ...creates
            .filter((other) => other.app === entry.app)
            .map((other) => ({
              slug: other.slug,
              name: other.declaration.name,
              reach: reach(entry.app, other.slug, undefined),
            })),
        ]
          .filter((other) => other.slug !== entry.slug && other.name.trim().toLowerCase() === name)
          .flatMap((other) => {
            const reach = other.reach
            if (own === "every" && reach === "every") return [{ other, place: "every space" }]
            const place = (own === "every" ? [...(reach === "every" ? [] : reach)] : [...own])
              .filter((space) => reach === "every" || reach.has(space))
              .map((space) => `space ${space}`)
              .at(0)
            return place ? [{ other, place }] : []
          })
          .at(0)
        return clash
          ? [
              {
                path: entry.target,
                message: `Profile ${clash.other.slug} of ${entry.app} is also named “${clash.other.name}” in ${clash.place}. Choose another name.`,
              },
            ]
          : []
      }),
    )

    const spaceIds = (app: string, slug: string) =>
      Effect.forEach(listers(app, slug), (space) => context.spaceId(space.slug))

    return {
      steps: [
        ...creates
          .map((entry) => {
            for (const space of listers(entry.app, entry.slug)) context.touch(space.liveId)
            return InfraPlan.step(
              "create",
              "profile",
              entry.target,
              Effect.gen(function* () {
                const appId = (yield* apps.get(context.actor, entry.app)).id
                const listed = yield* spaceIds(entry.app, entry.slug)
                const allSpaces = entry.declaration.allSpaces === true
                const existing = (yield* database.db
                  .select({
                    id: Database.Schema.app_profile.id,
                    name: Database.Schema.app_profile.name,
                    allSpaces: Database.Schema.app_profile.all_spaces,
                  })
                  .from(Database.Schema.app_profile)
                  .where(
                    and(
                      eq(Database.Schema.app_profile.organization_id, context.actor.organizationId),
                      eq(Database.Schema.app_profile.app_id, appId),
                      eq(Database.Schema.app_profile.slug, entry.slug),
                      eq(Database.Schema.app_profile.kind, "shared"),
                    ),
                  )
                  .pipe(Effect.orDie)).at(0)
                if (!existing)
                  return yield* profiles.create(context.actor, {
                    appId,
                    name: entry.declaration.name,
                    slug: entry.slug,
                    kind: "shared",
                    allSpaces,
                    spaceIds: listed,
                  })
                if (existing.name !== entry.declaration.name)
                  yield* profiles.update(context.actor, existing.id, { name: entry.declaration.name })
                return yield* profiles.access(context.actor, existing.id, {
                  add: listed,
                  ...(allSpaces && !existing.allSpaces && { allSpaces }),
                })
              }),
            )
          })
          .toSorted(InfraPlan.byPath),
        ...adds
          .map((add) => {
            context.touch(add.space.liveId)
            return InfraPlan.step(
              "create",
              "profile",
              add.target,
              Effect.gen(function* () {
                yield* profiles.access(context.actor, add.profile.id, { add: [yield* context.spaceId(add.space.slug)] })
              }),
            )
          })
          .toSorted(InfraPlan.byPath),
        ...updates
          .map((entry) =>
            InfraPlan.step(
              "update",
              "profile",
              entry.target,
              Effect.gen(function* () {
                if (entry.fields.includes("name"))
                  yield* profiles.update(context.actor, entry.current.id, { name: entry.declaration.name })
                if (entry.fields.includes("allSpaces"))
                  yield* profiles.access(context.actor, entry.current.id, {
                    allSpaces: entry.allSpaces,
                    ...(!entry.allSpaces && { add: yield* spaceIds(entry.app, entry.slug) }),
                  })
              }),
              { fields: entry.fields },
            ),
          )
          .toSorted(InfraPlan.byPath),
      ],
      removals: removals
        .map((removal) => {
          context.touch(removal.liveId)
          return InfraPlan.step(
            "archive",
            "profile",
            removal.target,
            profiles.unlist(context.actor, removal.profile.id, [removal.liveId]),
          )
        })
        .toSorted(InfraPlan.byPath),
      problems,
    }
  }

  const pull = (live: Live, spaceId: Space.ID): Record<string, ReadonlyArray<string>> =>
    Object.fromEntries(
      [
        ...Map.groupBy(
          live.profiles.filter((profile) => !profile.allSpaces && profile.spaces.includes(spaceId)),
          (profile) => profile.appSlug,
        ),
      ].map(([app, listed]) => [app, listed.map((profile) => profile.slug).toSorted()] as const),
    )

  const pullCatalogue = (live: Live) =>
    Object.fromEntries(
      [...Map.groupBy(live.profiles, (profile) => profile.appSlug)].map(([app, owned]) => [
        app,
        Object.fromEntries(
          owned.map((profile) => [profile.slug, canonical({ name: profile.name, allSpaces: profile.allSpaces })]),
        ),
      ]),
    )

  return { diff, pull, pullCatalogue }
})
