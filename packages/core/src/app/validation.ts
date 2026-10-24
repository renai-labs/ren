export * as AppValidation from "./validation.js"

import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import type { AppRelease } from "@ren/schema/app-release"
import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { Effect, Predicate } from "effect"
import type { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { AppQueries } from "./queries.js"

export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (Predicate.isObject(value))
    return `{${Object.keys(value)
      .filter((key) => !Predicate.isUndefined(value[key]))
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}

export const execution = (
  config: Omit<AppRelease.Configuration, "environment"> & {
    readonly environment?: AppRelease.Environment | undefined
  },
) =>
  canonical({
    requiredCredentials: config.requiredCredentials,
    environment: config.environment ?? null,
    skills: config.skills,
    mcps: config.mcps,
    dependsOn: [...new Set(config.dependsOn)].toSorted(),
  })

export const dependencies = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  access: Access.Interface,
  actor: Actor.Info,
  appId: App.ID,
  slugs: ReadonlyArray<string>,
) {
  return yield* Effect.forEach(
    [...new Set(slugs)].toSorted(),
    Effect.fnUntraced(function* (slug) {
      const found = yield* AppQueries.find(transaction, access, actor, slug)
      if (found.app.id === appId)
        return yield* new Primitive.Conflict({ message: `App “${slug}” cannot depend on itself.` })
      return found.app.id
    }),
  )
})

export const writeDependencies = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  releaseId: AppRelease.ID,
  ids: ReadonlyArray<App.ID>,
) {
  if (ids.length)
    yield* transaction
      .insert(Database.Schema.app_release_dependency)
      .values(ids.map((dependency_app_id) => ({ app_release_id: releaseId, dependency_app_id })))
})

export const finalGraph = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  input: {
    readonly organizationId: Auth.OrganizationID
    readonly spaceIds: ReadonlyArray<Space.ID>
  },
) {
  const spaces = yield* transaction
    .select()
    .from(Database.Schema.space)
    .where(
      and(eq(Database.Schema.space.organization_id, input.organizationId), isNull(Database.Schema.space.archived_at)),
    )
  const selections = yield* Effect.forEach(
    spaces,
    Effect.fnUntraced(function* (space) {
      return { space, selected: yield* AppQueries.inSpace(transaction, space.id) }
    }),
  )
  const releaseIds = [
    ...new Set(
      selections
        .filter((selection) => input.spaceIds.includes(selection.space.id))
        .flatMap((selection) => selection.selected.map((entry) => entry.release.id)),
    ),
  ]
  const edges = releaseIds.length
    ? yield* transaction
        .select()
        .from(Database.Schema.app_release_dependency)
        .where(inArray(Database.Schema.app_release_dependency.app_release_id, releaseIds))
    : []
  const edgesByRelease = Map.groupBy(edges, (edge) => edge.app_release_id)
  const claims = new Map<string, { app: string; source: string }>()
  const conflicts = selections.flatMap((selection) => {
    const space = selection.space
    const selected = selection.selected
    const affected = input.spaceIds.includes(space.id)
    const packages = new Map<string, string>()
    if (affected) {
      const selectedById = new Map(selected.map((entry) => [entry.app.id, entry]))
      const graph = new Map(
        selected.map((entry) => [
          entry.app.slug,
          {
            dependsOn: (edgesByRelease.get(entry.release.id) ?? []).map(
              (edge) => selectedById.get(edge.dependency_app_id)?.app.slug ?? edge.dependency_app_id,
            ),
          },
        ]),
      )
      const issue = App.dependencyIssues(graph).at(0)
      if (issue)
        return [
          `${issue.kind === "cycle" ? "Dependency cycle" : "Missing dependency"} in space ${space.id}: ${issue.path.join(" -> ")}.`,
        ]
    }
    return selected.flatMap((entry) =>
      [
        (["skills", "mcps"] as const).flatMap((kind) =>
          Object.keys(entry.release[kind]).flatMap((slug) => {
            const key = `${kind}/${slug}`
            const source = `${entry.app.slug}@${entry.release.version}/${kind}/${slug}`
            const existing = claims.get(key)
            if (existing && existing.app !== entry.app.id)
              return [`Component collision: ${existing.source} and ${source} in organization ${space.organization_id}.`]
            claims.set(key, { app: entry.app.id, source })
            return []
          }),
        ),
        affected
          ? Object.entries(entry.release.environment?.packages ?? {}).flatMap(([manager, requirements]) =>
              requirements.flatMap((requirement) => {
                const key = `${manager}/${packageName(manager, requirement)}`
                const previous = packages.get(key)
                if (previous && previous !== requirement)
                  return [
                    `Package conflict in space ${space.id}: ${key} requires both ${previous} and ${requirement} (${entry.app.slug}@${entry.release.version}).`,
                  ]
                packages.set(key, requirement)
                return []
              }),
            )
          : [],
      ].flat(),
    )
  })
  const conflict = conflicts.at(0)
  if (conflict) return yield* new Primitive.Conflict({ message: conflict })
})

export const packageName = (manager: string, requirement: string): string => {
  if (manager === "npm") return requirement.replace(/@[^@/]*$/u, "")
  if (manager === "pip")
    return (requirement.match(/^[A-Za-z0-9][A-Za-z0-9._-]*/u)?.at(0) ?? requirement)
      .toLowerCase()
      .replaceAll(/[._-]+/gu, "-")
  if (manager === "go") return requirement.split("@").at(0) ?? requirement
  return requirement.split(/[=\s]/u).at(0) ?? requirement
}
