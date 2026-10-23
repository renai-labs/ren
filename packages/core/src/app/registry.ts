export * as AppRegistry from "./registry.js"
export { Batch, Publication } from "@ren/schema/app-registry"

import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import type { AppListing } from "@ren/schema/app-listing"
import { AppRegistry } from "@ren/schema/app-registry"
import { AppRelease } from "@ren/schema/app-release"
import { Pagination } from "@ren/util/pagination"
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import { Context, Data, DateTime, Effect, Layer } from "effect"
import { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { AppQueries } from "./queries.js"
import { AppValidation } from "./validation.js"

export interface Interface extends Primitive.Interface<typeof AppRegistry.definition> {
  readonly publish: (
    batch: AppRegistry.Batch,
    options?: { readonly isDryRun?: boolean },
  ) => Effect.Effect<AppRegistry.BatchResult, Primitive.NotFound | Primitive.Conflict>
  readonly withdraw: (slug: string) => Effect.Effect<AppListing.Info, Primitive.NotFound | Primitive.Conflict>
  readonly relist: (slug: string) => Effect.Effect<AppListing.Info, Primitive.NotFound | Primitive.Conflict>
}
export class Service extends Context.Service<Service, Interface>()("@ren/core/AppRegistry") {}

const notFound = new Primitive.NotFound({ message: "Registry app not found." })

class DryRun extends Data.TaggedError("DryRun")<{ readonly result: AppRegistry.BatchResult }> {}

const listingInfo = (row: typeof Database.Schema.app_listing.$inferSelect): AppListing.Info => ({
  appId: row.app_id,
  body: row.body,
  categories: row.categories,
  examplePrompts: row.example_prompts,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  updatedAt: DateTime.fromDateUnsafe(row.updated_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

const listed = (appIds: ReadonlyArray<App.ID>) =>
  and(inArray(Database.Schema.app_listing.app_id, [...appIds]), isNull(Database.Schema.app_listing.archived_at))

const listedDependencies = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  apps: ReadonlyArray<typeof Database.Schema.app.$inferSelect>,
) {
  if (!apps.length) return
  const edges = yield* transaction
    .select({ releaseId: Database.Schema.app_release_dependency.app_release_id, dependency: Database.Schema.app })
    .from(Database.Schema.app_release_dependency)
    .innerJoin(
      Database.Schema.app,
      eq(Database.Schema.app.id, Database.Schema.app_release_dependency.dependency_app_id),
    )
    .where(
      inArray(
        Database.Schema.app_release_dependency.app_release_id,
        apps.map((app) => app.latest_release_id),
      ),
    )
  if (!edges.length) return
  const visible = new Set(
    (yield* transaction
      .select({ appId: Database.Schema.app_listing.app_id })
      .from(Database.Schema.app_listing)
      .where(listed(edges.map((edge) => edge.dependency.id)))).map((row) => row.appId),
  )
  const hidden = edges.find((edge) => !visible.has(edge.dependency.id))
  if (hidden)
    return yield* new Primitive.Conflict({
      message: `A listed app depends on “${hidden.dependency.slug}”, which is not listed. List it in this batch or relist it.`,
    })
})

const entries = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  rows: ReadonlyArray<{
    readonly app: typeof Database.Schema.app.$inferSelect
    readonly listing: typeof Database.Schema.app_listing.$inferSelect
  }>,
) {
  const releases = rows.length
    ? yield* AppQueries.releaseInfos(
        transaction,
        yield* transaction
          .select()
          .from(Database.Schema.app_release)
          .where(
            inArray(
              Database.Schema.app_release.id,
              rows.map((row) => row.app.latest_release_id),
            ),
          ),
      )
    : new Map<AppRelease.ID, AppRelease.Info>()
  return yield* Effect.forEach(rows, (row) => {
    const release = releases.get(row.app.latest_release_id)
    if (!release) return Effect.die(new Error("Latest release is missing"))
    return Effect.succeed({
      id: row.app.id,
      slug: row.app.slug,
      name: row.app.name,
      description: row.app.description,
      icon: row.app.icon,
      listing: listingInfo(row.listing),
      release,
    })
  })
})

const dependencyApps = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  batch: AppRegistry.Batch,
  locked: ReadonlyMap<string, typeof Database.Schema.app.$inferSelect>,
) {
  const duplicate = batch.apps
    .flatMap((app) =>
      app.dependsOn.flatMap((slug, index) =>
        app.dependsOn.indexOf(slug) !== index ? [`Duplicate dependency “${slug}” in app “${app.slug}”.`] : [],
      ),
    )
    .at(0)
  if (duplicate) return yield* new Primitive.Conflict({ message: duplicate })
  const graph = new Map<string, { readonly dependsOn: ReadonlyArray<string> }>(batch.apps.map((app) => [app.slug, app]))
  const outside = new Map<string, typeof Database.Schema.app.$inferSelect>()
  let pending = [...new Set(batch.apps.flatMap((app) => app.dependsOn))].filter((slug) => !graph.has(slug))
  while (pending.length) {
    const rows = yield* transaction
      .select()
      .from(Database.Schema.app)
      .where(and(inArray(Database.Schema.app.slug, pending), isNull(Database.Schema.app.archived_at)))
    const releases = yield* AppQueries.releaseInfos(
      transaction,
      rows.length
        ? yield* transaction
            .select()
            .from(Database.Schema.app_release)
            .where(
              inArray(
                Database.Schema.app_release.id,
                rows.map((row) => row.latest_release_id),
              ),
            )
        : [],
    )
    for (const row of rows) {
      outside.set(row.slug, row)
      graph.set(row.slug, { dependsOn: releases.get(row.latest_release_id)?.dependsOn ?? [] })
    }
    pending = [...new Set(rows.flatMap((row) => graph.get(row.slug)?.dependsOn ?? []))].filter(
      (slug) => !graph.has(slug),
    )
  }
  const issue = App.dependencyIssues(graph).at(0)
  if (issue?.kind === "missing")
    return yield* new Primitive.NotFound({ message: `Missing dependency: ${issue.path.join(" -> ")}.` })
  if (issue) return yield* new Primitive.Conflict({ message: `Dependency cycle: ${issue.path.join(" -> ")}.` })
  const visible = new Set(
    outside.size
      ? (yield* transaction
          .select({ appId: Database.Schema.app_listing.app_id })
          .from(Database.Schema.app_listing)
          .where(listed([...outside.values()].map((app) => app.id)))).map((row) => row.appId)
      : [],
  )
  const unavailable = batch.apps.flatMap((app) =>
    app.dependsOn.flatMap((slug) => {
      const dependency = outside.get(slug)
      const organizationId = locked.get(app.slug)?.organization_id ?? null
      return dependency &&
        dependency.organization_id &&
        dependency.organization_id !== organizationId &&
        !visible.has(dependency.id)
        ? [`App “${app.slug}” cannot depend on “${slug}”, which its users cannot install.`]
        : []
    }),
  )
  const blocked = unavailable.at(0)
  if (blocked) return yield* new Primitive.NotFound({ message: blocked })
  return outside
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const browse = (transaction: Database.Transaction, filter: ReturnType<typeof and>) =>
      transaction
        .select({ app: Database.Schema.app, listing: Database.Schema.app_listing })
        .from(Database.Schema.app)
        .innerJoin(
          Database.Schema.app_listing,
          and(
            eq(Database.Schema.app_listing.app_id, Database.Schema.app.id),
            isNull(Database.Schema.app_listing.archived_at),
          ),
        )
        .where(and(isNull(Database.Schema.app.archived_at), filter))
        .orderBy(asc(Database.Schema.app.slug))
    const isAllowed = (actor: Actor.Info, operation: "list" | "get") =>
      access.isAllowed({
        actor,
        action: Primitive.action(AppRegistry.definition, operation),
        resource: { relationships: [] },
      })
    const listing = Effect.fnUntraced(function* (transaction: Database.Transaction, slug: string) {
      const row = (yield* transaction
        .select({ app: Database.Schema.app, listing: Database.Schema.app_listing })
        .from(Database.Schema.app)
        .innerJoin(Database.Schema.app_listing, eq(Database.Schema.app_listing.app_id, Database.Schema.app.id))
        .where(eq(Database.Schema.app.slug, slug))).at(0)
      if (!row) return yield* notFound
      return row
    })
    const publish = Effect.fnUntraced(function* (transaction: Database.Transaction, batch: AppRegistry.Batch) {
      yield* AppQueries.registryLock(transaction)
      const slugs = batch.apps.map((app) => app.slug)
      const existing = slugs.length
        ? yield* transaction.select().from(Database.Schema.app).where(inArray(Database.Schema.app.slug, slugs))
        : []
      yield* Effect.forEach(
        [...new Set(existing.flatMap((app) => (app.organization_id ? [app.organization_id] : [])))].toSorted(),
        (organizationId) =>
          transaction.execute(
            sql`select pg_advisory_xact_lock(${AppQueries.gate.namespace}::int, hashtext(${organizationId}))`,
          ),
        { discard: true },
      )
      const locked = new Map(
        (existing.length
          ? yield* transaction
              .select()
              .from(Database.Schema.app)
              .where(
                inArray(
                  Database.Schema.app.id,
                  existing.map((app) => app.id),
                ),
              )
          : []
        ).map((app) => [app.slug, app]),
      )
      const archived = [...locked.values()].find((app) => app.archived_at)
      if (archived)
        return yield* new Primitive.Conflict({
          message: `App “${archived.slug}” is archived. Publication does not restore it.`,
        })
      const misowned = batch.apps
        .flatMap((publication) => {
          const current = locked.get(publication.slug)
          const named = publication.organizationId ?? null
          if (current ? current.organization_id === named : !named) return []
          if (!current)
            return [`No app “${publication.slug}” belongs to organization ${named}. Publication does not create one.`]
          return [
            current.organization_id
              ? `“${publication.slug}” is an organization’s app. Name its organization to list it.`
              : `“${publication.slug}” is a registry app, which no organization owns.`,
          ]
        })
        .at(0)
      if (misowned) return yield* new Primitive.Conflict({ message: misowned })
      const outside = yield* dependencyApps(transaction, batch, locked)
      const ordered: Array<AppRegistry.Publication> = []
      const visit = (slug: string): void => {
        const app = batch.apps.find((entry) => entry.slug === slug)
        if (!app || ordered.includes(app)) return
        for (const dependency of app.dependsOn) visit(dependency)
        ordered.push(app)
      }
      for (const slug of slugs) visit(slug)
      const ids = new Map([...outside.values(), ...locked.values()].map((app) => [app.slug, app.id]))
      const published = yield* Effect.forEach(ordered, (publication) =>
        Effect.gen(function* () {
          const current = locked.get(publication.slug)
          const dependencies = publication.dependsOn.flatMap((slug) => {
            const id = ids.get(slug)
            return id ? [id] : []
          })
          const metadata = {
            name: publication.name,
            description: publication.description,
            icon: publication.icon ?? null,
          }
          const release = {
            required_credentials: publication.requiredCredentials,
            environment: publication.environment,
            skills: publication.skills,
            mcps: publication.mcps,
          }
          const written = current
            ? yield* Effect.gen(function* () {
                const latest = (yield* transaction
                  .select()
                  .from(Database.Schema.app_release)
                  .where(eq(Database.Schema.app_release.id, current.latest_release_id))).at(0)
                if (!latest) return yield* Effect.die(new Error("Latest release is missing"))
                const isMetadataChanged =
                  current.name !== metadata.name ||
                  current.description !== metadata.description ||
                  current.icon !== metadata.icon
                const isExecutionChanged =
                  AppValidation.execution(yield* AppQueries.releaseInfo(transaction, latest)) !==
                  AppValidation.execution(publication)
                if (!isExecutionChanged) {
                  if (isMetadataChanged)
                    yield* transaction
                      .update(Database.Schema.app)
                      .set({ ...metadata, updated_at: sql`now()` })
                      .where(eq(Database.Schema.app.id, current.id))
                  return {
                    appId: current.id,
                    releaseId: latest.id,
                    version: latest.version,
                    isMetadataChanged,
                    isExecutionChanged,
                  }
                }
                if (publication.expectedCurrentReleaseId && publication.expectedCurrentReleaseId !== latest.id)
                  return yield* new Primitive.Conflict({
                    message: `The latest release of “${publication.slug}” changed. Reload before publishing a successor.`,
                  })
                const version = publication.version ?? AppRelease.nextVersion(latest.version, publication.bump)
                if (Bun.semver.order(version, latest.version) <= 0)
                  return yield* new Primitive.Conflict({
                    message: `“${publication.slug}” ${version} changes the execution configuration of its latest release ${latest.version}. Publish a greater version.`,
                  })
                const releaseId = AppRelease.ID.create()
                yield* transaction
                  .insert(Database.Schema.app_release)
                  .values({ id: releaseId, app_id: current.id, version, ...release })
                yield* AppValidation.writeDependencies(transaction, releaseId, dependencies)
                yield* transaction
                  .update(Database.Schema.app)
                  .set({ ...metadata, latest_release_id: releaseId, updated_at: sql`now()` })
                  .where(eq(Database.Schema.app.id, current.id))
                return { appId: current.id, releaseId, version, isMetadataChanged, isExecutionChanged }
              })
            : yield* Effect.gen(function* () {
                const appId = App.ID.create()
                const releaseId = AppRelease.ID.create()
                const version = publication.version ?? "1.0.0"
                yield* transaction
                  .insert(Database.Schema.app)
                  .values({ id: appId, slug: publication.slug, ...metadata, latest_release_id: releaseId })
                  .pipe(
                    Effect.catchTag(
                      "EffectDrizzleQueryError",
                      Primitive.uniqueConflict(
                        Database.Schema.appSlugConstraint,
                        `An app with the slug “${publication.slug}” already exists.`,
                      ),
                    ),
                  )
                yield* transaction
                  .insert(Database.Schema.app_release)
                  .values({ id: releaseId, app_id: appId, version, ...release })
                yield* AppValidation.writeDependencies(transaction, releaseId, dependencies)
                ids.set(publication.slug, appId)
                return { appId, releaseId, version, isMetadataChanged: true, isExecutionChanged: true }
              })
          const previous = (yield* transaction
            .select()
            .from(Database.Schema.app_listing)
            .where(eq(Database.Schema.app_listing.app_id, written.appId))).at(0)
          const listing = publication.listing && {
            body: publication.listing.body,
            categories: publication.listing.categories,
            example_prompts: [...publication.listing.examplePrompts],
          }
          const isListingChanged =
            Boolean(listing) &&
            (!previous ||
              AppValidation.canonical(listing) !==
                AppValidation.canonical({
                  body: previous.body,
                  categories: previous.categories,
                  example_prompts: previous.example_prompts,
                }))
          if (listing && isListingChanged)
            yield* previous
              ? transaction
                  .update(Database.Schema.app_listing)
                  .set({ ...listing, updated_at: sql`now()` })
                  .where(eq(Database.Schema.app_listing.app_id, written.appId))
              : transaction.insert(Database.Schema.app_listing).values({ ...listing, app_id: written.appId })
          return {
            appId: written.appId,
            slug: publication.slug,
            releaseId: written.releaseId,
            version: written.version,
            changed: {
              execution: written.isExecutionChanged,
              metadata: written.isMetadataChanged,
              listing: isListingChanged,
            },
          }
        }),
      )
      const results = new Map(published.map((result) => [result.slug, result]))
      const appIds = [...results.values()].map((result) => result.appId)
      const listedApps = appIds.length
        ? yield* transaction
            .select({ app: Database.Schema.app })
            .from(Database.Schema.app)
            .innerJoin(Database.Schema.app_listing, eq(Database.Schema.app_listing.app_id, Database.Schema.app.id))
            .where(and(inArray(Database.Schema.app.id, appIds), isNull(Database.Schema.app_listing.archived_at)))
        : []
      yield* listedDependencies(
        transaction,
        listedApps.map((row) => row.app),
      )
      const consumers = [
        ...new Set(
          (yield* Effect.forEach(
            published.filter((result) => result.changed.execution),
            (result) => AppQueries.consumers(transaction, result.appId),
          )).flat(),
        ),
      ]
      const spaces = consumers.length
        ? yield* transaction
            .select({ id: Database.Schema.space.id, organizationId: Database.Schema.space.organization_id })
            .from(Database.Schema.space)
            .where(inArray(Database.Schema.space.id, consumers))
        : []
      yield* Effect.forEach(
        [...new Set(spaces.map((space) => space.organizationId))],
        (organizationId) =>
          AppValidation.finalGraph(transaction, {
            organizationId,
            spaceIds: spaces.filter((space) => space.organizationId === organizationId).map((space) => space.id),
          }),
        { discard: true },
      )
      return {
        apps: slugs.flatMap((slug) => {
          const result = results.get(slug)
          return result ? [result] : []
        }),
      }
    })
    return Service.of({
      list: Effect.fn("AppRegistry.list")(function* (actor, input) {
        if (!isAllowed(actor, "list")) return Pagination.page([], input)
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const pattern = input.query && `%${input.query.replaceAll(/[\\%_]/gu, "\\$&")}%`
            const page = Pagination.page(
              yield* browse(
                transaction,
                and(
                  pattern
                    ? or(
                        ilike(Database.Schema.app.slug, pattern),
                        ilike(Database.Schema.app.name, pattern),
                        ilike(Database.Schema.app.description, pattern),
                      )
                    : undefined,
                  input.category
                    ? sql`exists (select 1 from jsonb_each(${Database.Schema.app_listing.categories}) as entry(key, value) where entry.value @> ${JSON.stringify([input.category])}::jsonb)`
                    : undefined,
                ),
              ),
              input,
            )
            return { ...page, items: yield* entries(transaction, page.items) }
          }),
        )
      }),
      get: Effect.fn("AppRegistry.get")(function* (actor, idOrSlug) {
        if (!isAllowed(actor, "get")) return yield* notFound
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* browse(
              transaction,
              idOrSlug.startsWith("app_")
                ? eq(Database.Schema.app.id, App.ID.make(idOrSlug))
                : eq(Database.Schema.app.slug, idOrSlug),
            )
            const entry = (yield* entries(transaction, rows)).at(0)
            if (!entry) return yield* notFound
            return entry
          }),
        )
      }),
      publish: Effect.fn("AppRegistry.publish")(function* (batch, options) {
        return yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const result = yield* publish(transaction, batch)
              if (options?.isDryRun) return yield* new DryRun({ result })
              return result
            }),
          )
          .pipe(Effect.catchTag("DryRun", (dryRun) => Effect.succeed(dryRun.result)))
      }),
      withdraw: Effect.fn("AppRegistry.withdraw")(function* (slug) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.registryLock(transaction)
            const found = yield* listing(transaction, slug)
            if (found.listing.archived_at) return listingInfo(found.listing)
            const dependents = yield* transaction
              .select({ slug: Database.Schema.app.slug })
              .from(Database.Schema.app)
              .innerJoin(
                Database.Schema.app_listing,
                and(
                  eq(Database.Schema.app_listing.app_id, Database.Schema.app.id),
                  isNull(Database.Schema.app_listing.archived_at),
                ),
              )
              .innerJoin(
                Database.Schema.app_release_dependency,
                and(
                  eq(Database.Schema.app_release_dependency.app_release_id, Database.Schema.app.latest_release_id),
                  eq(Database.Schema.app_release_dependency.dependency_app_id, found.app.id),
                ),
              )
              .where(isNull(Database.Schema.app.archived_at))
              .orderBy(asc(Database.Schema.app.slug))
            if (dependents.length)
              return yield* new Primitive.Conflict({
                message: `Listed apps depend on “${slug}”: ${dependents.map((row) => row.slug).join(", ")}. Withdraw them first.`,
              })
            const row = (yield* transaction
              .update(Database.Schema.app_listing)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(Database.Schema.app_listing.app_id, found.app.id))
              .returning()).at(0)
            if (!row) return yield* notFound
            return listingInfo(row)
          }),
        )
      }),
      relist: Effect.fn("AppRegistry.relist")(function* (slug) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.registryLock(transaction)
            const found = yield* listing(transaction, slug)
            if (found.app.archived_at)
              return yield* new Primitive.Conflict({ message: `App “${slug}” is archived and cannot be listed.` })
            if (!found.listing.archived_at) return listingInfo(found.listing)
            yield* listedDependencies(transaction, [found.app])
            const row = (yield* transaction
              .update(Database.Schema.app_listing)
              .set({ archived_at: null, updated_at: sql`now()` })
              .where(eq(Database.Schema.app_listing.app_id, found.app.id))
              .returning()).at(0)
            if (!row) return yield* notFound
            return listingInfo(row)
          }),
        )
      }),
    })
  }),
)
