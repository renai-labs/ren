export * as InfraApps from "./apps.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { App as AppSchema } from "@ren/schema/app"
import type { Space } from "@ren/schema/space"
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm"
import { Effect, Schema, Struct } from "effect"
import { App } from "../app.js"
import { AppQueries } from "../app/queries.js"
import { AppValidation } from "../app/validation.js"
import { InfraPlan } from "./plan.js"

export interface LiveApp {
  readonly id: AppSchema.ID
  readonly slug: string
  readonly ownerSpaceId: Space.ID
  readonly revision: number
  readonly declaration: AppSchema.Declaration
}

export interface Live {
  readonly apps: ReadonlyArray<LiveApp>
  readonly taken: ReadonlyArray<string>
}

const path = (space: string, slug: string) => `spaces/${space}/apps/${slug}`

export const canonical = (declaration: AppSchema.Declaration) => {
  const encoded = Schema.encodeSync(App.Declaration)(declaration)
  return {
    name: encoded.name,
    description: encoded.description,
    icon: encoded.icon ?? null,
    requiredCredentials: encoded.requiredCredentials,
    environment: encoded.environment ?? null,
    skills: encoded.skills,
    mcps: encoded.mcps,
    dependsOn: [...new Set(encoded.dependsOn)].toSorted(),
  }
}

const metadata = ["name", "description", "icon"] as const

const definition = ["requiredCredentials", "environment", "skills", "mcps", "dependsOn"] as const

export const load = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  declared: ReadonlyArray<string>,
) {
  const rows = yield* transaction
    .select()
    .from(Database.Schema.app)
    .where(
      and(
        eq(Database.Schema.app.organization_id, organizationId),
        isNotNull(Database.Schema.app.owner_space_id),
        isNull(Database.Schema.app.archived_at),
      ),
    )
    .orderBy(asc(Database.Schema.app.slug))
  const dependencies = yield* AppQueries.dependsOn(
    transaction,
    rows.map((row) => row.id),
  )
  const others =
    declared.length === 0
      ? []
      : yield* transaction
          .select({ slug: Database.Schema.app.slug })
          .from(Database.Schema.app)
          .where(
            and(
              inArray(Database.Schema.app.slug, [...declared]),
              or(
                isNull(Database.Schema.app.organization_id),
                ne(Database.Schema.app.organization_id, organizationId),
                isNotNull(Database.Schema.app.archived_at),
              ),
            ),
          )
          .orderBy(asc(Database.Schema.app.slug))
  return {
    apps: rows.flatMap((row): Array<LiveApp> => {
      const ownerSpaceId = row.owner_space_id
      if (!ownerSpaceId) return []
      return [
        {
          id: row.id,
          slug: row.slug,
          ownerSpaceId,
          revision: row.revision,
          declaration: {
            name: row.name,
            description: row.description,
            ...(row.icon && { icon: row.icon }),
            requiredCredentials: row.required_credentials,
            ...(row.environment && { environment: row.environment }),
            skills: row.skills,
            mcps: row.mcps,
            dependsOn: dependencies.get(row.id) ?? [],
          },
        },
      ]
    }),
    taken: [...new Set(others.map((row) => row.slug))],
  } satisfies Live
})

export const make = Effect.gen(function* () {
  const apps = yield* App.Service

  const diff = (context: InfraPlan.Context, live: Live): InfraPlan.Planned => {
    const inScope = live.apps.filter((app) => context.shared.has(app.ownerSpaceId))
    const outOfScope = new Set(live.apps.filter((app) => !context.shared.has(app.ownerSpaceId)).map((app) => app.slug))
    const bySlug = new Map(inScope.map((app) => [app.slug, app]))
    const taken = new Set(live.taken)
    const declared = context.spaces.flatMap((space) =>
      Object.entries(space.declaration.apps).map(([slug, app]) => ({ space: space.slug, slug, app })),
    )
    const problems = declared.flatMap((entry) => [
      ...(taken.has(entry.slug) || outOfScope.has(entry.slug)
        ? [
            {
              path: path(entry.space, entry.slug),
              message: `App slug “${entry.slug}” is taken by another app. Choose another slug.`,
            },
          ]
        : []),
      ...((entry.app.renamedFrom ?? []).length > 0
        ? [{ path: path(entry.space, entry.slug), message: "Infra does not rename apps yet. Remove renamedFrom." }]
        : []),
    ])

    const declaredBySlug = new Map(declared.map((entry) => [entry.slug, entry]))
    const liveIdOf = new Map(context.spaces.map((space) => [space.slug, space.liveId]))
    const ordered: Array<(typeof declared)[number]> = []
    const visit = (slug: string, seen: ReadonlySet<string>): void => {
      const entry = declaredBySlug.get(slug)
      if (!entry || ordered.includes(entry) || seen.has(slug)) return
      for (const dependency of entry.app.dependsOn) visit(dependency, new Set([...seen, slug]))
      ordered.push(entry)
    }
    for (const entry of declared) visit(entry.slug, new Set())

    const writes = ordered.flatMap((entry): Array<InfraPlan.Step> => {
      const target = path(entry.space, entry.slug)
      const declaration = entry.app
      const current = bySlug.get(entry.slug)
      if (!current) {
        context.touch(liveIdOf.get(entry.space))
        return [
          InfraPlan.step(
            "create",
            "app",
            target,
            Effect.gen(function* () {
              yield* apps.create(context.actor, {
                name: declaration.name,
                description: declaration.description,
                ...(declaration.icon && { icon: declaration.icon }),
                requiredCredentials: declaration.requiredCredentials,
                ...(declaration.environment && { environment: declaration.environment }),
                skills: declaration.skills,
                mcps: declaration.mcps,
                dependsOn: declaration.dependsOn,
                slug: entry.slug,
                ownerSpaceId: yield* context.spaceId(entry.space),
              })
            }),
          ),
        ]
      }
      const owner = context.slugOf(current.ownerSpaceId)
      const had = canonical(current.declaration)
      const wanted = canonical(declaration)
      const fields = InfraPlan.changed({
        owner: owner !== entry.space,
        metadata:
          AppValidation.canonical(Struct.pick(had, metadata)) !==
          AppValidation.canonical(Struct.pick(wanted, metadata)),
        definition:
          AppValidation.canonical(Struct.pick(had, definition)) !==
          AppValidation.canonical(Struct.pick(wanted, definition)),
      })
      if (fields.length === 0) return []
      context.touch(current.ownerSpaceId)
      context.touch(liveIdOf.get(entry.space))
      return [
        InfraPlan.step(
          "update",
          "app",
          target,
          Effect.gen(function* () {
            if (fields.includes("owner"))
              yield* apps.transferOwnership(context.actor, current.id, { spaceId: yield* context.spaceId(entry.space) })
            if (fields.includes("metadata") || fields.includes("definition"))
              yield* apps.update(context.actor, current.id, {
                name: declaration.name,
                description: declaration.description,
                icon: declaration.icon ?? null,
                requiredCredentials: declaration.requiredCredentials,
                ...(declaration.environment && { environment: declaration.environment }),
                skills: declaration.skills,
                mcps: declaration.mcps,
                dependsOn: declaration.dependsOn,
                expectedRevision: current.revision,
              })
          }),
          { fields, ...(owner && owner !== entry.space && { from: path(owner, entry.slug) }) },
        ),
      ]
    })

    const wanted = new Set(declared.map((entry) => entry.slug))
    const archives = inScope
      .filter((app) => !wanted.has(app.slug))
      .map((app) => {
        context.touch(app.ownerSpaceId)
        return InfraPlan.step(
          "archive",
          "app",
          path(context.slugOf(app.ownerSpaceId) ?? app.ownerSpaceId, app.slug),
          apps.archive(context.actor, app.id),
        )
      })

    return { steps: writes, removals: archives.toSorted(InfraPlan.byPath), problems }
  }

  const pull = (live: Live, spaceId: Space.ID) =>
    Object.fromEntries(
      live.apps.filter((app) => app.ownerSpaceId === spaceId).map((app) => [app.slug, app.declaration]),
    )

  return { diff, pull }
})
