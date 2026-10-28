export * as InfraProfiles from "./profiles.js"

import { Database } from "@ren/db/database"
import type { AppProfile } from "@ren/schema/app-profile"
import type { Auth } from "@ren/schema/auth"
import type { Infra } from "@ren/schema/infra"
import type { Space } from "@ren/schema/space"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { Effect } from "effect"
import { AppProfiles } from "../app/profiles.js"
import { InfraPlan } from "./plan.js"

export interface LiveProfile {
  readonly id: AppProfile.ID
  readonly appSlug: string
  readonly slug: string
  readonly allSpaces: boolean
  readonly spaces: ReadonlyArray<Space.ID>
}

export interface Live {
  readonly profiles: ReadonlyArray<LiveProfile>
}

const path = (space: string, app: string, profile: string) => `deploy.yaml/spaces/${space}/profiles/${app}/${profile}`

export const load = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
) {
  const rows = yield* transaction
    .select({
      id: Database.Schema.app_profile.id,
      appSlug: Database.Schema.app.slug,
      slug: Database.Schema.app_profile.slug,
      allSpaces: Database.Schema.app_profile.all_spaces,
    })
    .from(Database.Schema.app_profile)
    .innerJoin(Database.Schema.app, eq(Database.Schema.app.id, Database.Schema.app_profile.app_id))
    .where(
      and(
        eq(Database.Schema.app_profile.organization_id, organizationId),
        eq(Database.Schema.app_profile.kind, "shared"),
        isNull(Database.Schema.app.archived_at),
      ),
    )
    .orderBy(asc(Database.Schema.app.slug), asc(Database.Schema.app_profile.slug))
  const listings =
    rows.length === 0
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
              rows.map((row) => row.id),
            ),
          )
          .orderBy(asc(Database.Schema.app_profile_space.profile_id), asc(Database.Schema.app_profile_space.space_id))
  const spaces = Map.groupBy(listings, (listing) => listing.profileId)
  return {
    profiles: rows.map((row) => ({
      id: row.id,
      appSlug: row.appSlug,
      slug: row.slug,
      allSpaces: row.allSpaces,
      spaces: (spaces.get(row.id) ?? []).map((listing) => listing.spaceId),
    })),
  } satisfies Live
})

export const make = Effect.gen(function* () {
  const profiles = yield* AppProfiles.Service

  const diff = (context: InfraPlan.Context, live: Live): InfraPlan.Planned => {
    const problems: Array<Infra.Problem> = []
    const byApp = Map.groupBy(live.profiles, (profile) => profile.appSlug)
    const pairs = context.spaces.flatMap((space) =>
      Object.entries(space.bindings?.profiles ?? {}).map(([app, slugs]) => ({
        space,
        app,
        slugs: [...new Set(slugs)],
        live: (byApp.get(app) ?? []).filter((profile) => !profile.allSpaces),
      })),
    )

    const adds = pairs.flatMap((pair) =>
      pair.slugs.flatMap((slug) => {
        const target = path(pair.space.slug, pair.app, slug)
        const profile = (byApp.get(pair.app) ?? []).find((candidate) => candidate.slug === slug)
        if (!profile) {
          problems.push({ path: target, message: `Create the shared profile ${slug} of ${pair.app} in Ren first.` })
          return []
        }
        if (profile.allSpaces) {
          problems.push({
            path: target,
            message: `Profile ${slug} of ${pair.app} is shared with every space. Remove it from deploy.yaml.`,
          })
          return []
        }
        const liveId = pair.space.liveId
        if (liveId && profile.spaces.includes(liveId)) return []
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

    return {
      steps: adds
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

  return { diff, pull }
})
