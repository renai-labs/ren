export * as AppValidation from "./validation.js"

import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import type { AppProfile } from "@ren/schema/app-profile"
import type { Auth } from "@ren/schema/auth"
import { and, eq, inArray, isNull, min } from "drizzle-orm"
import { Effect, Predicate } from "effect"
import type { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { ProfileItems } from "./profile-items.js"
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
  definition: Omit<App.Definition, "environment"> & { readonly environment?: App.Environment | undefined },
) =>
  canonical({
    requiredCredentials: definition.requiredCredentials,
    environment: definition.environment ?? null,
    skills: definition.skills,
    mcps: definition.mcps,
    dependsOn: [...new Set(definition.dependsOn)].toSorted(),
  })

// oxlint-disable-next-line ren/no-comments -- Only a registry app declares a managed MCP (integrations spec, decision 1): an org could otherwise send Ren's integrations token to a server of its own choice.
export const refuseManaged = (mcps: App.Definition["mcps"]) =>
  Object.values(mcps).some((mcp) => mcp.transport.type === "managed")
    ? Effect.fail(new Primitive.Invalid({ message: "Only a registry app can declare a managed MCP." }))
    : Effect.void

export const refuseSpaceName = (name: string, space: { readonly name: string }) =>
  name.trim().toLowerCase() === space.name.trim().toLowerCase()
    ? Effect.fail(new Primitive.Conflict({ message: `An app cannot have the name of its space, “${space.name}”.` }))
    : Effect.void

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

// oxlint-disable-next-line ren/no-comments -- Replaces the app's edges. A change refuses a cycle or a chain deeper than App.maxDepth through the app: down every app it reaches, and up the apps of its own organization, or the registry, that depend on it.
export const writeDependencies = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  app: { readonly id: App.ID; readonly slug: string; readonly organization_id: Auth.OrganizationID | null },
  ids: ReadonlyArray<App.ID>,
) {
  const edges = Database.Schema.app_dependency
  const before = (yield* transaction
    .delete(edges)
    .where(eq(edges.app_id, app.id))
    .returning({ id: edges.dependency_app_id })).map((edge) => edge.id)
  if (ids.length)
    yield* transaction.insert(edges).values(ids.map((dependency_app_id) => ({ app_id: app.id, dependency_app_id })))
  if (before.length === ids.length && ids.every((id) => before.includes(id))) return
  const related = new Set<App.ID>([app.id])
  const walk = Effect.fnUntraced(function* (direction: "down" | "up") {
    let pending: ReadonlyArray<App.ID> = [app.id]
    while (pending.length) {
      const found = yield* transaction
        .select({ app: edges.app_id, dependency: edges.dependency_app_id })
        .from(edges)
        .innerJoin(Database.Schema.app, eq(Database.Schema.app.id, edges.app_id))
        .where(
          direction === "down"
            ? inArray(edges.app_id, [...pending])
            : and(
                inArray(edges.dependency_app_id, [...pending]),
                app.organization_id
                  ? eq(Database.Schema.app.organization_id, app.organization_id)
                  : isNull(Database.Schema.app.organization_id),
              ),
        )
      pending = [...new Set(found.map((edge) => (direction === "down" ? edge.dependency : edge.app)))].filter(
        (id) => !related.has(id),
      )
      for (const id of pending) related.add(id)
    }
  })
  yield* walk("down")
  yield* walk("up")
  const rows = yield* transaction
    .select({ id: Database.Schema.app.id, slug: Database.Schema.app.slug })
    .from(Database.Schema.app)
    .where(inArray(Database.Schema.app.id, [...related]))
  const slugs = new Map(rows.map((row) => [row.id, row.slug]))
  const byApp = Map.groupBy(
    yield* transaction
      .select()
      .from(edges)
      .where(inArray(edges.app_id, [...related])),
    (edge) => edge.app_id,
  )
  const graph = new Map(
    rows.map((row) => [
      row.slug,
      {
        dependsOn: (byApp.get(row.id) ?? []).flatMap((edge) => {
          const slug = slugs.get(edge.dependency_app_id)
          return slug ? [slug] : []
        }),
      },
    ]),
  )
  const issue = App.dependencyIssues(graph).at(0)
  if (issue) return yield* new Primitive.Conflict({ message: App.describeIssue(issue) })
})

type Row = typeof Database.Schema.app.$inferSelect

export interface Member {
  readonly row: Row
  readonly dependsOn: ReadonlyArray<App.ID>
  readonly seniority: number
}

export interface Claims {
  readonly members: ReadonlyMap<App.ID, Member>
  readonly skipped: ReadonlyMap<App.ID, ReadonlyArray<AppProfile.Skipped>>
}

const namesOf = (row: Pick<Row, "mcps" | "skills" | "required_credentials">) => [
  ...Object.keys(row.mcps).map((slug) => ({ kind: "mcps" as const, slug })),
  ...Object.keys(row.skills).map((slug) => ({ kind: "skills" as const, slug })),
  ...ProfileItems.declared(
    { mcps: row.mcps, skills: row.skills, requiredCredentials: row.required_credentials },
    "x",
  ).flatMap((item) => ("env" in item.item ? [{ kind: "env" as const, slug: item.item.env }] : [])),
]

// oxlint-disable-next-line ren/no-comments -- §8 rules 6 and 7 (P24, P25, P35): the apps in an org are the apps with a profile there and the apps they depend on. Each MCP slug, skill slug and env key belongs to the oldest of them, by its first profile in the org; a dependency is as old as its oldest dependent. A newer app's parts with a taken name are skipped.
export const claims = Effect.fnUntraced(function* (
  client: Pick<Database.Transaction, "select">,
  organizationId: Auth.OrganizationID,
  replaced: ReadonlyArray<{ readonly row: Row; readonly dependsOn: ReadonlyArray<App.ID> }> = [],
) {
  const firsts = yield* client
    .select({ appId: Database.Schema.app_profile.app_id, first: min(Database.Schema.app_profile.created_at) })
    .from(Database.Schema.app_profile)
    .where(eq(Database.Schema.app_profile.organization_id, organizationId))
    .groupBy(Database.Schema.app_profile.app_id)
  const overrides = new Map(replaced.map((entry) => [entry.row.id, entry]))
  const seniority = new Map<App.ID, number>(firsts.map((row) => [row.appId, row.first?.getTime() ?? Date.now()]))
  const members = new Map<App.ID, Member>()
  const visited = new Set<App.ID>()
  let pending = [...seniority.keys()]
  while (pending.length) {
    for (const id of pending) visited.add(id)
    const rows = (yield* client
      .select()
      .from(Database.Schema.app)
      .where(and(inArray(Database.Schema.app.id, pending), isNull(Database.Schema.app.archived_at)))).map(
      (row) => overrides.get(row.id)?.row ?? row,
    )
    const edges = yield* client
      .select()
      .from(Database.Schema.app_dependency)
      .where(inArray(Database.Schema.app_dependency.app_id, pending))
    const byApp = Map.groupBy(edges, (edge) => edge.app_id)
    for (const row of rows) {
      const own = seniority.get(row.id) ?? Number.MAX_SAFE_INTEGER
      const dependsOn =
        overrides.get(row.id)?.dependsOn ?? (byApp.get(row.id) ?? []).map((edge) => edge.dependency_app_id)
      members.set(row.id, { row, dependsOn, seniority: own })
      for (const dependency of dependsOn)
        seniority.set(dependency, Math.min(seniority.get(dependency) ?? Number.MAX_SAFE_INTEGER, own))
    }
    pending = [...new Set([...members.values()].flatMap((member) => member.dependsOn))].filter((id) => !visited.has(id))
  }
  const ordered = [...members.values()]
    .map((member): Member => ({
      row: member.row,
      dependsOn: member.dependsOn,
      seniority: seniority.get(member.row.id) ?? member.seniority,
    }))
    .toSorted((left, right) => left.seniority - right.seniority || left.row.slug.localeCompare(right.row.slug))
  const owners = new Map<string, Row>()
  const skipped = new Map(
    ordered.map((member) => [
      member.row.id,
      namesOf(member.row).flatMap((name): ReadonlyArray<AppProfile.Skipped> => {
        const key = `${name.kind}/${name.slug}`
        const owner = owners.get(key)
        if (owner && owner.id !== member.row.id) return [{ ...name, also: owner.slug }]
        owners.set(key, member.row)
        return []
      }),
    ]),
  )
  return {
    members: new Map(ordered.map((member) => [member.row.id, member])),
    skipped,
  } satisfies Claims
})

const kinds = { mcps: "MCP", skills: "Skill", env: "Env key" } as const

// oxlint-disable-next-line ren/no-comments -- §8 rule 6: a write that Ren can refuse gives a clash in its own app; clashes that a registry publish left between other apps stay skipped (P25).
export const names = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  changed: ReadonlyArray<{ readonly row: Row; readonly dependsOn: ReadonlyArray<App.ID> }>,
) {
  const found = yield* claims(transaction, organizationId, changed)
  const ids = new Set(changed.map((entry) => entry.row.id))
  const involved = (id: App.ID) =>
    ids.has(id) || [...ids].some((changedId) => found.members.get(changedId)?.dependsOn.includes(id) ?? false)
  const clash = [...found.skipped.entries()]
    .flatMap(([appId, skipped]) =>
      skipped.flatMap((entry) => {
        const owner = [...found.members.values()].find((member) => member.row.slug === entry.also)
        return involved(appId) || (owner && ids.has(owner.row.id))
          ? [
              `${kinds[entry.kind]} “${entry.slug}” is in apps “${entry.also}” and “${found.members.get(appId)?.row.slug ?? appId}”. Move it into a shared dependency app.`,
            ]
          : []
      }),
    )
    .at(0)
  if (clash) return yield* new Primitive.Conflict({ message: clash })
})
