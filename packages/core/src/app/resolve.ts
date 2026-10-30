export * as AppResolve from "./resolve.js"

import { Database } from "@ren/db/database"
import type { App } from "@ren/schema/app"
import type { AppCatalog } from "@ren/schema/app-catalog"
import { Credential } from "@ren/schema/credential"
import type { Mcp } from "@ren/schema/mcp"
import { and, eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import type { Credentials } from "../credentials.js"
import { Integrations } from "../integrations.js"
import { McpProvider } from "../mcp-provider.js"
import { Primitive } from "../primitive.js"
import { ProfileItems } from "./profile-items.js"
import { ProfileLabel } from "./profile-label.js"
import { AppProfiles } from "./profiles.js"
import { AppSelection } from "./selection.js"
import { AppValidation } from "./validation.js"

export interface Interface {
  readonly forScope: (scope: Credentials.Scope) => Effect.Effect<AppCatalog.Info, Primitive.NotFound>
}
export class Service extends Context.Service<Service, Interface>()("@ren/core/AppResolve") {}

type AppRow = typeof Database.Schema.app.$inferSelect

const hash = (value: unknown) => new Bun.CryptoHasher("sha256").update(AppValidation.canonical(value)).digest("hex")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const registry = yield* McpProvider.Registry
    const integrationsUrl = yield* Integrations.url

    const isSetUp = (provider: string) => Effect.map(Effect.option(registry.get(provider)), Option.isSome)

    // oxlint-disable-next-line ren/no-comments -- What a catalog depends on: the reached profiles, the org's apps and their revisions (names clash org-wide, P25), the reached profiles' credentials (P23), the brain's egress (C53), the providers this Ren has (P38) and where its managed MCPs run.
    const inputs = Effect.fnUntraced(function* (scope: Credentials.Scope) {
      if (scope.workload.kind === "brain") {
        const space = (yield* database.db
          .select({ archivedAt: Database.Schema.space.archived_at })
          .from(Database.Schema.brain)
          .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.brain.space_id))
          .where(eq(Database.Schema.brain.id, scope.workload.id))).at(0)
        if (!space || space.archivedAt) return yield* new Primitive.NotFound({ message: "Space not found." })
      }
      const reached = yield* AppProfiles.reachable(database.db, scope)
      const claims = yield* AppValidation.claims(database.db, scope.organizationId)
      const connected = reached.length
        ? yield* database.db
            .select({
              profileId: Database.Schema.credential.profile_id,
              label: Database.Schema.credential.label,
              id: Database.Schema.credential.id,
              hosts: Database.Schema.credential.hosts,
            })
            .from(Database.Schema.credential)
            .where(
              and(
                eq(Database.Schema.credential.owner, "profile"),
                inArray(
                  Database.Schema.credential.profile_id,
                  reached.map((profile) => profile.id),
                ),
              ),
            )
        : []
      const egress =
        scope.workload.kind === "brain"
          ? ((yield* database.db
              .select({ egress: Database.Schema.brain.egress })
              .from(Database.Schema.brain)
              .where(eq(Database.Schema.brain.id, scope.workload.id))).at(0)?.egress ?? false)
          : true
      const providers = [
        ...new Set(
          [...claims.members.values()].flatMap((member) =>
            Object.values(member.row.mcps).flatMap((mcp) =>
              mcp.transport.type === "provider" ? [mcp.transport.provider] : [],
            ),
          ),
        ),
      ].toSorted()
      const available = yield* Effect.filter(providers, isSetUp)
      return { reached, claims, connected, egress, available, integrationsUrl }
    })

    const fingerprintOf = (found: Effect.Success<ReturnType<typeof inputs>>) =>
      hash({
        reached: found.reached,
        apps: [...found.claims.members.values()].map((member) => [
          member.row.id,
          member.row.revision,
          member.row.name,
          member.row.updated_at.toISOString(),
        ]),
        connected: found.connected
          .map((row) => `${row.profileId}/${row.label}/${row.id}`)
          .toSorted((left, right) => left.localeCompare(right)),
        egress: found.egress,
        available: found.available,
        integrationsUrl: Option.getOrNull(Option.map(found.integrationsUrl, (url) => url.href)),
      })

    // oxlint-disable-next-line ren/no-comments -- profiles.md §6.1, §8: each reached profile gives one server per connected MCP item (`<mcp>__<slug>`) and its local MCPs whose required keys are connected; an MCP with auth none is one server per app (P22). An item without a credential is absent (P23). A part that an older app in the org names is skipped (P25). Without a provider layer or an egress, a credential-backed server is listed as unavailable.
    const build = (found: Effect.Success<ReturnType<typeof inputs>>): AppCatalog.Catalog => {
      const apps = new Map([...found.claims.members.values()].map((member) => [member.row.id, member.row]))
      const skipped = (appId: App.ID, kind: "mcps" | "skills" | "env", slug: string) =>
        (found.claims.skipped.get(appId) ?? []).some((entry) => entry.kind === kind && entry.slug === slug)
      const labels = new Set(found.connected.map((row) => `${row.profileId}/${row.label}`))
      const hosts = new Map(found.connected.map((row) => [`${row.profileId}/${row.label}`, row.hosts.at(0)]))
      const available = new Set(found.available)
      const reachedApps = new Set(found.reached.map((profile) => profile.appId))
      const implied = new Set<App.ID>()
      const visit = (id: App.ID) => {
        const member = found.claims.members.get(id)
        for (const dependency of member?.dependsOn ?? []) {
          const row = apps.get(dependency)
          const hasItems =
            row &&
            ProfileItems.declared(
              { mcps: row.mcps, skills: row.skills, requiredCredentials: row.required_credentials },
              "x",
            ).length > 0
          if (row && !hasItems && !reachedApps.has(dependency) && !implied.has(dependency)) {
            implied.add(dependency)
            visit(dependency)
          }
        }
      }
      for (const id of reachedApps) visit(id)
      const ordered = [...reachedApps, ...implied]
        .flatMap((id) => {
          const row = apps.get(id)
          return row ? [row] : []
        })
        .toSorted((left, right) => left.slug.localeCompare(right.slug))
      const sortedMcps = (row: AppRow) =>
        Object.entries(row.mcps)
          .filter(([slug]) => !skipped(row.id, "mcps", slug))
          .toSorted(([left], [right]) => left.localeCompare(right))
      const open = ordered.flatMap((row) =>
        sortedMcps(row).flatMap(([slug, declaration]): ReadonlyArray<AppCatalog.McpEntry> => {
          const needsEnv = declaration.requiredCredentials.some((requirement) => requirement.kind === "env")
          if (
            declaration.auth.type !== "none" ||
            declaration.transport.type === "managed" ||
            (declaration.transport.type === "local" && needsEnv)
          )
            return []
          return [
            {
              appId: row.id,
              appSlug: row.slug,
              slug,
              declaration,
              server: ProfileLabel.serverOf(slug),
              profile: null,
              label: null,
            },
          ]
        }),
      )
      const unavailable: Array<AppCatalog.Unavailable> = []
      const reasonOf = (transport: Mcp.Transport): AppCatalog.Unavailable["reason"] | undefined => {
        if (transport.type === "provider" && !available.has(transport.provider)) return "provider"
        return found.egress ? undefined : "egress"
      }
      // oxlint-disable-next-line ren/no-comments -- §6.4 rule 4 (K25): a provider MCP is called on its credential's host, with the label as the first path segment.
      const addressOf = (transport: Mcp.Transport, key: string | null) => {
        const label = key?.split("/").at(1)
        return transport.type === "provider" && key && label
          ? { url: `https://${hosts.get(key) ?? ""}/${Credential.placeholder(label)}/` }
          : {}
      }
      const owned = found.reached.flatMap((profile) => {
        const row = apps.get(profile.appId)
        if (!row) return []
        const ref = { id: profile.id, slug: profile.slug, name: profile.name, kind: profile.kind }
        return sortedMcps(row).flatMap(([slug, declaration]): ReadonlyArray<AppCatalog.McpEntry> => {
          const env = declaration.requiredCredentials.flatMap((requirement) =>
            requirement.kind === "env" && !skipped(row.id, "env", requirement.name)
              ? [{ requirement, label: ProfileLabel.labelOf({ env: requirement.name }, profile.slug) }]
              : [],
          )
          const isLocal = declaration.transport.type === "local"
          const isItem = declaration.auth.type !== "none"
          if (!isItem && !(isLocal && env.length)) return []
          const label = isItem ? ProfileLabel.labelOf({ mcp: slug }, profile.slug) : null
          if (label && !labels.has(`${profile.id}/${label}`)) return []
          const connectedEnv = env.filter((entry) => labels.has(`${profile.id}/${entry.label}`))
          if (env.some((entry) => !entry.requirement.optional && !connectedEnv.includes(entry))) return []
          const reason = reasonOf(declaration.transport)
          if (reason) {
            unavailable.push({ appSlug: row.slug, mcp: slug, profile: profile.name, reason })
            return []
          }
          return [
            {
              appId: row.id,
              appSlug: row.slug,
              slug,
              declaration,
              server: ProfileLabel.serverOf(slug, profile.slug),
              profile: ref,
              label,
              ...addressOf(declaration.transport, label && `${profile.id}/${label}`),
              ...(isLocal && {
                env: Object.fromEntries(
                  connectedEnv.map((entry) => [entry.requirement.name, Credential.placeholder(entry.label)]),
                ),
              }),
            },
          ]
        })
      })
      const selected = AppSelection.select({
        resolved: [...owned, ...open],
        declared: ordered.flatMap((row) =>
          sortedMcps(row).map(([slug, declaration]) => ({ appId: row.id, appSlug: row.slug, slug, declaration })),
        ),
        integrationsUrl: found.integrationsUrl,
        egress: found.egress,
      })
      return {
        apps: ordered.map((row) => ({
          appId: row.id,
          appSlug: row.slug,
          name: row.name,
          profiles: found.reached
            .filter((profile) => profile.appId === row.id)
            .map((profile) => ({
              slug: profile.slug,
              name: profile.name,
              kind: profile.kind,
              env: Object.fromEntries(
                ProfileItems.declared(
                  { mcps: row.mcps, skills: row.skills, requiredCredentials: row.required_credentials },
                  profile.slug,
                ).flatMap((item) =>
                  "env" in item.item &&
                  !skipped(row.id, "env", item.item.env) &&
                  labels.has(`${profile.id}/${item.label}`)
                    ? [[item.item.env, item.label]]
                    : [],
                ),
              ),
            })),
        })),
        mcps: selected.mcps,
        skills: ordered.flatMap((row) =>
          Object.entries(row.skills)
            .filter(([slug]) => !skipped(row.id, "skills", slug))
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([slug, declaration]) => ({ appId: row.id, appSlug: row.slug, slug, declaration })),
        ),
        unavailable: [...unavailable, ...selected.unavailable],
      }
    }

    return Service.of({
      forScope: Effect.fn("AppResolve.forScope")(function* (scope) {
        const found = yield* inputs(scope).pipe(Effect.catchTag("EffectDrizzleQueryError", Effect.die))
        return { fingerprint: fingerprintOf(found), catalog: build(found) }
      }),
    })
  }),
)
