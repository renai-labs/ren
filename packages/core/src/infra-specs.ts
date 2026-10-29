export * as InfraSpecs from "./infra-specs.js"

import { Database } from "@ren/db/database"
import type { Agent as AgentSchema } from "@ren/schema/agent"
import type { ChannelMapping } from "@ren/schema/channel-mapping"
import { Factory } from "@ren/schema/factory"
import { Infra } from "@ren/schema/infra"
import { Settings } from "@ren/schema/settings"
import type { Space as SpaceSchema } from "@ren/schema/space"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Predicate, Schema, Struct } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { Agent } from "./agent.js"
import { AgentMembership } from "./agent/membership.js"
import { AppValidation } from "./app/validation.js"
import { InfraApps } from "./infra-specs/apps.js"
import { InfraChannels } from "./infra-specs/channels.js"
import { InfraPlan } from "./infra-specs/plan.js"
import { InfraPolicy } from "./infra-specs/policy.js"
import { InfraProfiles } from "./infra-specs/profiles.js"
import { InfraSchedules } from "./infra-specs/schedules.js"
import { InfraVersions } from "./infra-specs/versions.js"
import { OrganizationSettings } from "./organization-settings.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"
import { SpaceQueries } from "./space/queries.js"
import { SpaceSettings } from "./space/settings.js"
import { SettingsRows } from "./settings/rows.js"

type Failure = InfraPlan.Failure

export interface Interface {
  readonly pull: (
    actor: Actor.Info,
    input: Infra.PullInput,
  ) => Effect.Effect<Infra.Pulled, Primitive.Forbidden | Primitive.Invalid>
  readonly plan: (actor: Actor.Info, input: Infra.PlanInput) => Effect.Effect<Infra.Plan, Primitive.Forbidden>
  readonly apply: (actor: Actor.Info, input: Infra.ApplyInput) => Effect.Effect<Infra.Applied, Failure>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/InfraSpecs") {}

interface LiveSpace {
  readonly id: SpaceSchema.ID
  readonly slug: string
  readonly kind: SpaceSchema.Kind
  readonly name: string
  readonly description: string | null
  readonly settings: Settings.Info
  readonly factory: Factory.Info
  readonly isMember: boolean
}

interface LiveAgent {
  readonly id: AgentSchema.ID
  readonly name: string
  readonly description: string | null
  readonly isSubagent: boolean
  readonly settings: Settings.Info
  readonly ownerSpaceId: SpaceSchema.ID
}

interface Live {
  readonly organization: { readonly slug: string; readonly settings: Settings.Info }
  readonly firstSpaceId: SpaceSchema.ID | undefined
  readonly spaces: ReadonlyArray<LiveSpace>
  readonly agents: ReadonlyArray<LiveAgent>
  readonly memberships: ReadonlyArray<{ readonly spaceId: SpaceSchema.ID; readonly agentId: AgentSchema.ID }>
  readonly globals: ReadonlyArray<{ readonly id: AgentSchema.ID; readonly name: string }>
  readonly apps: InfraApps.Live
  readonly schedules: InfraSchedules.Live
  readonly channels: InfraChannels.Live
  readonly profiles: InfraProfiles.Live
}

type Step = InfraPlan.Step

type Verdict = "apply" | "changed" | "new" | "conflict"

const rank = { apply: 0, changed: 1, new: 1, conflict: 2 } satisfies Record<Verdict, number>

const described = (
  change: Infra.Change,
  values: ReadonlyArray<Infra.Value>,
  status?: Exclude<Verdict, "apply">,
): Infra.Change => ({
  action: change.action,
  kind: change.kind,
  path: change.path,
  ...(change.from && { from: change.from }),
  fields: change.fields,
  values,
  ...(status && { status }),
})

const unsupported = ["webhooks"] as const

const sameSettings = Schema.toEquivalence(Settings.Info)

const sameFactory = Schema.toEquivalence(Infra.FactoryDeclaration)

const noFactory: Infra.FactoryDeclaration = { maxHandoffs: Factory.defaultMaxHandoffs, agents: [] }

const factoryNames = (factory: Factory.Info, names: ReadonlyMap<string, string>): Infra.FactoryDeclaration => {
  const name = (id: string) => names.get(id) ?? id
  return {
    maxHandoffs: factory.maxHandoffs,
    agents: factory.agents
      .filter((entry) => names.has(entry.agentId))
      .map((entry) =>
        Struct.renameKeys(
          Struct.evolve(entry, {
            agentId: name,
            to: (to) =>
              (to ?? [])
                .filter((edge) => names.has(edge.agentId))
                .map((edge) =>
                  Struct.renameKeys(
                    Struct.evolve(!edge.else || names.has(edge.else) ? edge : Struct.omit(edge, ["else"]), {
                      agentId: name,
                      else: (id: string | undefined) => name(id ?? ""),
                    }),
                    { agentId: "agent" },
                  ),
                ),
          }),
          { agentId: "agent" },
        ),
      ),
  }
}

interface Claim {
  readonly key: string
  readonly path: string
  readonly renamedFrom: ReadonlyArray<string> | undefined
}

const resolve = <L>(
  noun: string,
  claims: ReadonlyArray<Claim>,
  live: ReadonlyMap<string, L>,
  name: (row: L) => string,
) => {
  const found = claims.map((claim) => ({
    claim,
    rows: [...new Set([claim.key, ...(claim.renamedFrom ?? [])].flatMap((key) => live.get(key) ?? []))],
  }))
  const claimants = Map.groupBy(
    found.flatMap((entry) => entry.rows.map((row) => ({ row, path: entry.claim.path }))),
    (entry) => entry.row,
  )
  return {
    rows: found.map((entry) => entry.rows.at(0)),
    problems: [
      ...found
        .filter((entry) => entry.rows.length > 1)
        .map((entry) => ({
          path: entry.claim.path,
          message: `More than one live ${noun} matches: ${entry.rows
            .map((row) => `“${name(row)}”`)
            .toSorted()
            .join(", ")}. Keep one, and archive the others in the app.`,
        })),
      ...[...claimants.values()]
        .filter((entries) => entries.length > 1)
        .flatMap((entries) =>
          entries.map((entry) => ({
            path: entry.path,
            message: `${entries
              .filter((other) => other.path !== entry.path)
              .map((other) => other.path)
              .join(" and ")} is also renamed from “${name(entry.row)}”. Only one can be.`,
          })),
        ),
    ],
  }
}

const changed = InfraPlan.changed

const step = InfraPlan.step

const byPath = InfraPlan.byPath

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const spaces = yield* Space.Service
    const spaceSettings = yield* SpaceSettings.Service
    const organizationSettings = yield* OrganizationSettings.Service
    const agents = yield* Agent.Service
    const memberships = yield* AgentMembership.Service
    const kinds = {
      apps: yield* InfraApps.make,
      schedules: yield* InfraSchedules.make,
      channels: yield* InfraChannels.make,
      profiles: yield* InfraProfiles.make,
    }

    const authorize = (actor: Actor.Info, action: string) =>
      access.isAllowed({ actor, action, resource: Access.organization })
        ? Effect.void
        : Effect.fail(new Primitive.Forbidden({ message: "Only organization admins can use the org spec." }))

    const load = (actor: Actor.Info, input?: Infra.PlanInput) =>
      database
        .transaction((transaction) =>
          Effect.gen(function* () {
            const organization = (yield* transaction
              .select({ slug: Database.Schema.organization.slug, settings: Database.Schema.settings })
              .from(Database.Schema.organization)
              .leftJoin(
                Database.Schema.settings,
                eq(Database.Schema.settings.owner_id, Database.Schema.organization.id),
              )
              .where(eq(Database.Schema.organization.id, actor.organizationId))).at(0)
            if (!organization) return yield* Effect.die(new Error("The organization of the actor is missing"))
            const first = (yield* transaction
              .select({ id: Database.Schema.space.id })
              .from(Database.Schema.space)
              .where(eq(Database.Schema.space.organization_id, actor.organizationId))
              .orderBy(asc(Database.Schema.space.created_at), asc(Database.Schema.space.id))
              .limit(1)).at(0)
            const spaceRows = yield* transaction
              .select({
                space: Database.Schema.space,
                settings: Database.Schema.settings,
                membershipId: SpaceQueries.membership.id,
              })
              .from(Database.Schema.space)
              .leftJoin(Database.Schema.settings, eq(Database.Schema.settings.owner_id, Database.Schema.space.id))
              .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
              .where(
                and(
                  eq(Database.Schema.space.organization_id, actor.organizationId),
                  isNull(Database.Schema.space.archived_at),
                ),
              )
              .orderBy(asc(Database.Schema.space.slug))
            const agentRows = yield* transaction
              .select({ agent: Database.Schema.agent, settings: Database.Schema.settings })
              .from(Database.Schema.agent)
              .leftJoin(Database.Schema.settings, eq(Database.Schema.settings.owner_id, Database.Schema.agent.id))
              .where(
                and(
                  eq(Database.Schema.agent.organization_id, actor.organizationId),
                  isNull(Database.Schema.agent.archived_at),
                ),
              )
              .orderBy(asc(Database.Schema.agent.name))
            const membershipRows = yield* transaction
              .select({
                spaceId: Database.Schema.agent_membership.space_id,
                agentId: Database.Schema.agent_membership.agent_id,
              })
              .from(Database.Schema.agent_membership)
              .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.agent_membership.space_id))
              .where(eq(Database.Schema.space.organization_id, actor.organizationId))
              .orderBy(asc(Database.Schema.agent_membership.space_id), asc(Database.Schema.agent_membership.agent_id))
            const globals = yield* transaction
              .select({ id: Database.Schema.agent.id, name: Database.Schema.agent.name })
              .from(Database.Schema.agent)
              .where(
                and(
                  isNull(Database.Schema.agent.organization_id),
                  isNull(Database.Schema.agent.archived_at),
                  eq(Database.Schema.agent.is_subagent, false),
                ),
              )
              .orderBy(asc(Database.Schema.agent.name))
            const declaredApps = Object.values(input?.spec.spaces ?? {}).flatMap((space) => Object.keys(space.apps))
            const apps = yield* InfraApps.load(transaction, actor.organizationId, declaredApps)
            const schedules = yield* InfraSchedules.load(transaction, actor.organizationId)
            const channels = yield* InfraChannels.load(transaction, actor.organizationId)
            const profiles = yield* InfraProfiles.load(transaction, actor.organizationId)
            return {
              organization: {
                slug: organization.slug,
                settings: (yield* SettingsRows.decode(organization.settings)).settings,
              },
              firstSpaceId: first?.id,
              spaces: yield* Effect.forEach(spaceRows, (row) =>
                Effect.map(SettingsRows.decode(row.settings), (decoded) => ({
                  id: row.space.id,
                  slug: row.space.slug,
                  kind: row.space.kind,
                  name: row.space.name,
                  description: row.space.description,
                  settings: decoded.settings,
                  factory: row.space.factory,
                  isMember: Boolean(row.membershipId),
                })),
              ),
              agents: yield* Effect.forEach(
                agentRows.flatMap((row) => {
                  const ownerSpaceId = row.agent.owner_space_id
                  return ownerSpaceId ? [{ ...row, ownerSpaceId }] : []
                }),
                (row) =>
                  Effect.map(SettingsRows.decode(row.settings), (decoded) => ({
                    id: row.agent.id,
                    name: row.agent.name,
                    description: row.agent.description,
                    isSubagent: row.agent.is_subagent,
                    settings: decoded.settings,
                    ownerSpaceId: row.ownerSpaceId,
                  })),
              ),
              memberships: membershipRows,
              globals,
              apps,
              schedules,
              channels,
              profiles,
            } satisfies Live
          }),
        )
        .pipe(Effect.orDie)

    const scope = (live: Live) => {
      const shared = live.spaces.filter((space) => space.kind === "shared")
      const sharedIds = new Set(shared.map((space) => space.id))
      const owned = live.agents.filter((agent) => sharedIds.has(agent.ownerSpaceId))
      const ownedIds = new Set(owned.map((agent) => agent.id))
      return {
        shared,
        owned,
        memberships: live.memberships.filter(
          (membership) => sharedIds.has(membership.spaceId) && ownedIds.has(membership.agentId),
        ),
        factoryNames: new Map([...live.globals, ...owned].map((agent) => [agent.id, agent.name])),
      }
    }

    const snapshot = (live: Live, aliases: ReadonlyMap<ChannelMapping.ID, string>) => {
      const inScope = scope(live)
      const names = new Map(inScope.owned.map((agent) => [agent.id, agent.name]))
      const factoryOf = (factory: Factory.Info) => {
        const named = factoryNames(factory, inScope.factoryNames)
        return sameFactory(named, noFactory) ? {} : { factory: named }
      }
      const pulledNames = (id: AgentSchema.ID) => inScope.factoryNames.get(id)
      return {
        bindings: {
          organization: live.organization.slug,
          spaces: Object.fromEntries(
            inScope.shared.flatMap((space) => {
              const channels = kinds.channels.pullBindings(live.channels, space.id, aliases)
              const profiles = kinds.profiles.pull(live.profiles, space.id)
              return Object.keys(channels).length + Object.keys(profiles).length > 0
                ? [[space.slug, { channels, profiles }]]
                : []
            }),
          ),
        },
        spec: {
          org: { settings: live.organization.settings },
          spaces: Object.fromEntries(
            inScope.shared.map((space) => [
              space.slug,
              {
                name: space.name,
                ...(Predicate.isNotNull(space.description) && { description: space.description }),
                settings: space.settings,
                ...factoryOf(space.factory),
                agents: Object.fromEntries(
                  inScope.owned
                    .filter((agent) => agent.ownerSpaceId === space.id)
                    .map((agent) => [
                      agent.name,
                      {
                        ...(Predicate.isNotNull(agent.description) && { description: agent.description }),
                        isSubagent: agent.isSubagent,
                        settings: agent.settings,
                      },
                    ]),
                ),
                apps: kinds.apps.pull(live.apps, space.id),
                schedules: kinds.schedules.pull(live.schedules, space.id, pulledNames),
                channels: kinds.channels.pull(live.channels, space.id, pulledNames, aliases),
                uses: {
                  agents: inScope.memberships
                    .filter((membership) => membership.spaceId === space.id)
                    .flatMap((membership) => names.get(membership.agentId) ?? [])
                    .toSorted(),
                },
              },
            ]),
          ),
        },
      }
    }

    const liveResources = (live: Live, aliases: ReadonlyMap<ChannelMapping.ID, string>) => {
      const pulled = snapshot(live, aliases)
      return InfraVersions.resources({
        org: pulled.spec.org,
        spaces: pulled.spec.spaces,
        bindings: pulled.bindings.spaces,
      })
    }

    const folderResources = (spec: Infra.Spec, bindings: Infra.Bindings, live: InfraVersions.Resources) =>
      InfraVersions.resources({ org: spec.org, spaces: spec.spaces, bindings: bindings.spaces }, live)

    const lockOf = (live: Live, lock: Infra.Lock | undefined) =>
      lock?.organization === live.organization.slug ? lock.resources : {}

    const diff = (actor: Actor.Info, live: Live, input: Infra.PlanInput) => {
      const inScope = scope(live)
      const spec = input.spec
      const declared = Object.entries(spec.spaces)
      const liveSpaces = new Map(inScope.shared.map((space) => [space.slug, space]))
      const liveAgents = new Map(inScope.owned.map((agent) => [agent.name, agent]))
      const problems: Array<Infra.Problem> = []

      const spaceResolved = resolve(
        "space",
        declared.map(([slug, declaration]) => ({
          key: slug,
          path: `spaces/${slug}`,
          renamedFrom: declaration.renamedFrom,
        })),
        liveSpaces,
        (space) => space.slug,
      )
      const spaceMatches = declared.map(([slug, declaration], index) => ({
        slug,
        declaration,
        live: spaceResolved.rows.at(index),
      }))
      const declaredAgents = declared.flatMap(([space, declaration]) =>
        Object.entries(declaration.agents).map(([name, agent]) => ({ space, name, declaration: agent })),
      )
      const agentResolved = resolve(
        "agent",
        declaredAgents.map((agent) => ({
          key: agent.name,
          path: `spaces/${agent.space}/agents/${agent.name}`,
          renamedFrom: agent.declaration.renamedFrom,
        })),
        liveAgents,
        (agent) => agent.name,
      )
      const agentMatches = declaredAgents.map((agent, index) => ({
        space: agent.space,
        name: agent.name,
        declaration: agent.declaration,
        live: agentResolved.rows.at(index),
      }))
      problems.push(...spaceResolved.problems, ...agentResolved.problems)

      const spaceIds = new Map(spaceMatches.flatMap((match) => (match.live ? [[match.slug, match.live.id]] : [])))
      const agentIds = new Map(agentMatches.flatMap((match) => (match.live ? [[match.name, match.live.id]] : [])))
      const slugOf = new Map(spaceMatches.flatMap((match) => (match.live ? [[match.live.id, match.slug]] : [])))
      const nameOf = new Map(agentMatches.flatMap((match) => (match.live ? [[match.live.id, match.name]] : [])))
      const liveById = new Map(live.spaces.map((space) => [space.id, space]))
      const spaceId = (slug: string) => {
        const id = spaceIds.get(slug)
        return id ? Effect.succeed(id) : Effect.die(new Error(`Space ${slug} has no id`))
      }
      const agentId = (name: string) => {
        const id = agentIds.get(name)
        return id ? Effect.succeed(id) : Effect.die(new Error(`Agent ${name} has no id`))
      }
      const touched: Array<SpaceSchema.ID> = []

      const taken = {
        slugs: new Set(live.spaces.filter((space) => space.kind !== "shared").map((space) => space.slug)),
        names: new Set(live.agents.filter((agent) => !inScope.owned.includes(agent)).map((agent) => agent.name)),
      }
      problems.push(
        ...spaceMatches
          .filter((match) => taken.slugs.has(match.slug))
          .map((match) => ({
            path: `spaces/${match.slug}`,
            message: `Space slug “${match.slug}” is already taken. Choose another slug.`,
          })),
        ...agentMatches
          .filter((match) => taken.names.has(match.name))
          .map((match) => ({
            path: `spaces/${match.space}/agents/${match.name}`,
            message: `Agent name “${match.name}” is already taken. Choose another name.`,
          })),
      )

      const organization = sameSettings(spec.org.settings, live.organization.settings)
        ? []
        : [
            step(
              "update",
              "organization",
              "org",
              organizationSettings.update(actor, actor.organizationId, { settings: spec.org.settings }),
              { fields: ["settings"] },
            ),
          ]

      const spaceSteps = spaceMatches.flatMap((match): Array<Step> => {
        const path = `spaces/${match.slug}`
        const declaration = match.declaration
        const current = match.live
        if (!current)
          return [
            step(
              "create",
              "space",
              path,
              Effect.gen(function* () {
                const created = yield* spaces.create(actor, {
                  name: declaration.name,
                  slug: match.slug,
                  description: declaration.description,
                })
                spaceIds.set(match.slug, created.id)
                if (!sameSettings(declaration.settings, { permissions: [], references: [] }))
                  yield* spaceSettings.update(actor, created.id, { settings: declaration.settings })
              }),
            ),
          ]
        const fields = changed({
          slug: current.slug !== match.slug,
          name: current.name !== declaration.name,
          description: current.description !== (declaration.description ?? null),
          settings: !sameSettings(current.settings, declaration.settings),
        })
        if (fields.length === 0) return []
        touched.push(current.id)
        return [
          step(
            "update",
            "space",
            path,
            Effect.gen(function* () {
              if (fields.includes("slug")) yield* spaces.changeSlug(actor, current.id, match.slug)
              if (fields.includes("name") || fields.includes("description"))
                yield* spaces.update(actor, current.id, {
                  ...(fields.includes("name") && { name: declaration.name }),
                  ...(fields.includes("description") && { description: declaration.description ?? null }),
                })
              if (fields.includes("settings"))
                yield* spaceSettings.update(actor, current.id, { settings: declaration.settings })
            }),
            { fields, ...(current.slug !== match.slug && { from: `spaces/${current.slug}` }) },
          ),
        ]
      })

      const transfers: Array<{
        readonly agent: AgentSchema.ID
        readonly from: SpaceSchema.ID
        readonly to: SpaceSchema.ID | undefined
      }> = []
      const agentSteps = agentMatches.flatMap((match): Array<Step> => {
        const path = `spaces/${match.space}/agents/${match.name}`
        const declaration = match.declaration
        const current = match.live
        const owner = spaceIds.get(match.space)
        if (owner && (!current || current.ownerSpaceId !== owner)) touched.push(owner)
        if (!current)
          return [
            step(
              "create",
              "agent",
              path,
              Effect.gen(function* () {
                const created = yield* agents.create(actor, {
                  ownerSpaceId: yield* spaceId(match.space),
                  name: match.name,
                  description: declaration.description,
                  isSubagent: declaration.isSubagent,
                  settings: declaration.settings,
                })
                agentIds.set(match.name, created.id)
              }),
            ),
          ]
        const fields = changed({
          name: current.name !== match.name,
          owner: slugOf.get(current.ownerSpaceId) !== match.space,
          description: current.description !== (declaration.description ?? null),
          isSubagent: current.isSubagent !== declaration.isSubagent,
          settings: !sameSettings(current.settings, declaration.settings),
        })
        if (fields.length === 0) return []
        touched.push(current.ownerSpaceId)
        if (fields.includes("owner")) transfers.push({ agent: current.id, from: current.ownerSpaceId, to: owner })
        const before = `spaces/${liveById.get(current.ownerSpaceId)?.slug}/agents/${current.name}`
        return [
          step(
            "update",
            "agent",
            path,
            Effect.gen(function* () {
              if (fields.includes("owner"))
                yield* agents.transferOwnership(actor, current.id, { spaceId: yield* spaceId(match.space) })
              if (fields.some((field) => field !== "owner"))
                yield* agents.update(actor, current.id, {
                  ...(fields.includes("name") && { name: match.name }),
                  ...(fields.includes("description") && { description: declaration.description ?? null }),
                  ...(fields.includes("isSubagent") && { isSubagent: declaration.isSubagent }),
                  ...(fields.includes("settings") && { settings: declaration.settings }),
                })
            }),
            { fields, ...(before !== path && { from: before }) },
          ),
        ]
      })

      const effective = [
        ...inScope.memberships.filter(
          (membership) =>
            !transfers.some((transfer) => transfer.agent === membership.agentId && transfer.to === membership.spaceId),
        ),
        ...transfers.map((transfer) => ({ spaceId: transfer.from, agentId: transfer.agent })),
      ]
      const liveAgentsById = new Map(inScope.owned.map((agent) => [agent.id, agent]))
      const usePath = (space: string, agent: string) => `spaces/${space}/uses/agents/${agent}`
      const current = new Map(
        effective.map((membership) => [
          usePath(
            slugOf.get(membership.spaceId) ?? liveById.get(membership.spaceId)?.slug ?? membership.spaceId,
            nameOf.get(membership.agentId) ?? liveAgentsById.get(membership.agentId)?.name ?? membership.agentId,
          ),
          membership,
        ]),
      )
      const wanted = new Map(
        declared.flatMap(([space, declaration]) =>
          declaration.uses.agents.map((agent) => [usePath(space, agent), { space, agent }] as const),
        ),
      )
      const ownerOf = (name: string) => agentMatches.find((match) => match.name === name)?.space
      const membershipCreates = [...wanted]
        .filter(([path]) => !current.has(path))
        .map(([path, use]) => {
          const target = spaceIds.get(use.space)
          const owner = spaceIds.get(ownerOf(use.agent) ?? "")
          if (target) touched.push(target)
          if (owner) touched.push(owner)
          return step(
            "create",
            "membership",
            path,
            Effect.gen(function* () {
              yield* memberships.create(actor, {
                agentId: yield* agentId(use.agent),
                spaceId: yield* spaceId(use.space),
              })
            }),
          )
        })
      const globalIds = new Map(live.globals.map((agent) => [agent.name, agent.id]))
      const factorySteps = spaceMatches.flatMap((match): Array<Step> => {
        const declared = match.declaration.factory ?? noFactory
        if (sameFactory(declared, match.live ? factoryNames(match.live.factory, inScope.factoryNames) : noFactory))
          return []
        if (match.live) touched.push(match.live.id)
        const idOf = (name: string) => agentIds.get(name) ?? globalIds.get(name) ?? name
        return [
          step(
            "update",
            "space",
            `spaces/${match.slug}`,
            Effect.gen(function* () {
              yield* spaces.update(actor, yield* spaceId(match.slug), {
                factory: {
                  maxHandoffs: declared.maxHandoffs,
                  agents: declared.agents.map((entry) =>
                    Struct.renameKeys(
                      Struct.evolve(entry, {
                        agent: idOf,
                        to: (to) =>
                          (to ?? []).map((edge) =>
                            Struct.renameKeys(
                              Struct.evolve(edge, { agent: idOf, else: (agent) => idOf(agent ?? "") }),
                              {
                                agent: "agentId",
                              },
                            ),
                          ),
                      }),
                      { agent: "agentId" },
                    ),
                  ),
                },
              })
            }),
            { fields: ["factory"] },
          ),
        ]
      })
      const membershipArchives = [...current]
        .filter(([path]) => !wanted.has(path))
        .map(([path, membership]) => {
          touched.push(membership.spaceId)
          return step(
            "archive",
            "membership",
            path,
            Effect.gen(function* () {
              const row = (yield* database.db
                .select({ id: Database.Schema.agent_membership.id })
                .from(Database.Schema.agent_membership)
                .where(
                  and(
                    eq(Database.Schema.agent_membership.space_id, membership.spaceId),
                    eq(Database.Schema.agent_membership.agent_id, membership.agentId),
                  ),
                )
                .pipe(Effect.orDie)).at(0)
              if (row) yield* memberships.archive(actor, row.id)
            }),
          )
        })

      const agentArchives = inScope.owned
        .filter((agent) => !nameOf.has(agent.id))
        .map((agent) => {
          touched.push(agent.ownerSpaceId)
          return step(
            "archive",
            "agent",
            `spaces/${liveById.get(agent.ownerSpaceId)?.slug}/agents/${agent.name}`,
            agents.archive(actor, agent.id),
          )
        })
      const spaceArchives = inScope.shared
        .filter((space) => !slugOf.has(space.id))
        .map((space) => {
          touched.push(space.id)
          if (space.id === live.firstSpaceId)
            problems.push({
              path: `spaces/${space.slug}`,
              message: "This is the first space of the organization, so it cannot be archived. Declare it.",
            })
          return step("archive", "space", `spaces/${space.slug}`, spaces.archive(actor, space.id))
        })

      const context: InfraPlan.Context = {
        actor,
        spaces: spaceMatches.map((match) => ({
          slug: match.slug,
          declaration: match.declaration,
          bindings: input.bindings.spaces[match.slug],
          liveId: match.live?.id,
        })),
        shared: new Set(inScope.shared.map((space) => space.id)),
        slugOf: (id) => slugOf.get(id) ?? liveById.get(id)?.slug,
        spaceId,
        agentId,
        agentName: (id) => nameOf.get(id) ?? inScope.factoryNames.get(id),
        touch: (id) => {
          if (id) touched.push(id)
        },
      }
      const planned = {
        apps: kinds.apps.diff(context, live.apps),
        schedules: kinds.schedules.diff(context, live.schedules),
        channels: kinds.channels.diff(context, live.channels),
        profiles: kinds.profiles.diff(context, live.profiles),
      }
      problems.push(
        ...planned.apps.problems,
        ...planned.schedules.problems,
        ...planned.channels.problems,
        ...planned.profiles.problems,
      )

      const steps = [
        ...organization,
        ...spaceSteps.toSorted(byPath),
        ...agentSteps.toSorted(byPath),
        ...membershipCreates.toSorted(byPath),
        ...factorySteps.toSorted(byPath),
        ...planned.apps.steps,
        ...planned.schedules.steps,
        ...planned.channels.steps,
        ...planned.profiles.steps,
        ...planned.profiles.removals,
        ...planned.channels.removals,
        ...planned.schedules.removals,
        ...planned.apps.removals,
        ...membershipArchives.toSorted(byPath),
        ...agentArchives.toSorted(byPath),
        ...spaceArchives.toSorted(byPath),
      ]

      problems.push(
        ...[...new Set(touched)]
          .flatMap((id) => liveById.get(id) ?? [])
          .filter((space) => space.kind === "shared" && !space.isMember)
          .map((space) => ({
            path: `spaces/${space.slug}`,
            message: "Join this space first: the plan changes it, and only its members can.",
          })),
      )
      if (input.bindings.organization !== live.organization.slug)
        problems.push({
          path: "deploy.yaml",
          message: `deploy.yaml names “${input.bindings.organization}”, but you are signed in to “${live.organization.slug}”.`,
        })
      if (input.lock && input.lock.organization !== live.organization.slug)
        problems.push({
          path: "ren.lock",
          message: `ren.lock is for “${input.lock.organization}”, but you are signed in to “${live.organization.slug}”.`,
        })
      const bound = Object.entries(input.bindings.spaces)
      problems.push(
        ...bound
          .filter(([, bindings]) => bindings.timezone)
          .map(([slug]) => ({
            path: `deploy.yaml/spaces/${slug}/timezone`,
            message: "Infra does not apply the timezone of a space yet.",
          })),
        ...bound
          .filter(([, bindings]) => Object.keys(bindings.webhooks).length > 0)
          .map(([slug]) => ({
            path: `deploy.yaml/spaces/${slug}/webhooks`,
            message: "Infra does not apply webhooks yet.",
          })),
        ...bound
          .filter(([slug]) => !(slug in input.spec.spaces))
          .map(([slug]) => ({
            path: `deploy.yaml/spaces/${slug}`,
            message: `deploy.yaml binds space “${slug}”, which the spec does not declare.`,
          })),
      )
      problems.push(
        ...declared.flatMap(([slug, declaration]) =>
          unsupported
            .filter((kind) => Object.keys(declaration[kind]).length > 0)
            .map((kind) => ({ path: `spaces/${slug}/${kind}`, message: `Infra does not apply ${kind} yet.` })),
        ),
        ...declared
          .filter(([, declaration]) => declaration.environment)
          .map(([slug]) => ({
            path: `spaces/${slug}/environment`,
            message: "Infra does not apply environments yet.",
          })),
      )

      return {
        steps,
        problems: problems.toSorted(
          (left, right) => left.path.localeCompare(right.path) || left.message.localeCompare(right.message),
        ),
        aliases: planned.channels.aliases,
      }
    }

    const plan = Effect.fnUntraced(function* (actor: Actor.Info, input: Infra.PlanInput) {
      const live = yield* load(actor, input)
      const planned = diff(actor, live, input)
      const theirs = liveResources(live, planned.aliases)
      const mine = folderResources(input.spec, input.bindings, theirs)
      const liveVersions = InfraVersions.versions(theirs)
      const folderVersions = InfraVersions.versions(mine)
      const seen = lockOf(live, input.lock)
      const verdictOf = (step: Step, base: string): Verdict => {
        const version = seen[base]
        if (liveVersions.get(base) === version) return "apply"
        if (step.change.from || folderVersions.get(step.change.path) !== version) return "conflict"
        return version ? "changed" : "new"
      }
      const judged = planned.steps.map((step) => {
        const base = step.change.from ?? step.change.path
        return { step, base, verdict: verdictOf(step, base) }
      })
      const worst = new Map(
        [...Map.groupBy(judged, (entry) => entry.step.change.path)].map(([path, entries]) => [
          path,
          entries.reduce<Verdict>(
            (found, entry) => (rank[entry.verdict] > rank[found] ? entry.verdict : found),
            "apply",
          ),
        ]),
      )
      const applied = (path: string) => worst.get(path) === "apply"
      const archived = new Set(
        judged.flatMap((entry) =>
          entry.step.change.action === "archive" && applied(entry.step.change.path) ? [entry.step.change.path] : [],
        ),
      )
      const stays = (space: string) =>
        (liveVersions.has(space) && !archived.has(space)) ||
        judged.some(
          (entry) => entry.step.change.path === space && entry.step.change.action !== "archive" && applied(space),
        )
      const held = new Set([
        ...judged.flatMap((entry) => {
          const path = entry.step.change.path
          if (entry.step.change.kind !== "space" || !archived.has(path)) return []
          const retained = [...liveVersions.keys()].filter(
            (child) => InfraVersions.spaceOf(child) === path && !archived.has(child),
          )
          return retained.length > 0 ? [path, ...retained] : []
        }),
        ...judged.flatMap((entry) => {
          const path = entry.step.change.path
          const space = InfraVersions.spaceOf(path)
          if (!space || entry.step.change.action === "archive" || !applied(path) || stays(space)) return []
          return [path, space]
        }),
      ])
      const steps = judged.map((entry) => ({
        step: entry.step,
        base: entry.base,
        verdict: held.has(entry.step.change.path) ? "conflict" : (worst.get(entry.step.change.path) ?? entry.verdict),
      }))
      const firsts = new Map(steps.map((entry, index) => [entry.step.change.path, index] as const).toReversed())
      const changes = steps.flatMap((entry, index): Array<Infra.Change> => {
        const change = entry.step.change
        const first = firsts.get(change.path) === index
        const values = InfraVersions.values(theirs.get(entry.base)?.value, mine.get(change.path)?.value)
        if (entry.verdict === "apply") return [first && change.action === "update" ? described(change, values) : change]
        return first ? [described(change, values, entry.verdict)] : []
      })
      return {
        steps,
        changes,
        problems: planned.problems,
        seen,
        digest: new Bun.CryptoHasher("sha256")
          .update(
            AppValidation.canonical(
              steps
                .filter((entry) => entry.verdict === "apply" || entry.verdict === "conflict")
                .map((entry) => ({
                  change: entry.step.change,
                  verdict: entry.verdict,
                  from: liveVersions.get(entry.base) ?? null,
                  to: folderVersions.get(entry.step.change.path) ?? null,
                })),
            ),
          )
          .digest("hex"),
        lock: {
          organization: live.organization.slug,
          resources: InfraVersions.next(folderVersions, liveVersions, seen),
        },
      }
    })

    const at =
      (path: string) =>
      <A, R>(effect: Effect.Effect<A, Failure, R>) =>
        effect.pipe(
          Effect.mapError((error): Failure => {
            const message = `${path}: ${error.message}`
            switch (error._tag) {
              case "Primitive.NotFound":
                return new Primitive.NotFound({ message })
              case "Primitive.Forbidden":
                return new Primitive.Forbidden({ message })
              case "Primitive.Conflict":
                return new Primitive.Conflict({ message })
              case "Primitive.Invalid":
                return new Primitive.Invalid({ message, ...(error.field && { field: error.field }) })
            }
          }),
        )

    return Service.of({
      pull: Effect.fn("InfraSpecs.pull")(function* (actor: Actor.Info, input: Infra.PullInput) {
        yield* authorize(actor, InfraPolicy.actions.pull)
        const live = yield* load(actor)
        const organization = live.organization.slug
        if (input.bindings && input.bindings.organization !== organization)
          return yield* new Primitive.Invalid({
            message: `deploy.yaml names “${input.bindings.organization}”, but you are signed in to “${organization}”.`,
          })
        if (input.lock && input.lock.organization !== organization)
          return yield* new Primitive.Invalid({
            message: `ren.lock is for “${input.lock.organization}”, but you are signed in to “${organization}”.`,
          })
        const bindings = input.bindings ?? { organization, spaces: {} }
        const aliases = input.spec ? diff(actor, live, { spec: input.spec, bindings }).aliases : new Map()
        const known = liveResources(live, aliases)
        const merged = InfraVersions.merge(
          input.spec ? folderResources(input.spec, bindings, known) : new Map(),
          known,
          input.lock?.resources ?? {},
        )
        return {
          ...snapshot(live, aliases),
          lock: { organization: live.organization.slug, resources: merged.lock },
          write: merged.write,
          remove: merged.remove,
          conflicts: merged.conflicts,
        }
      }),
      plan: Effect.fn("InfraSpecs.plan")(function* (actor: Actor.Info, input: Infra.PlanInput) {
        yield* authorize(actor, InfraPolicy.actions.plan)
        const result = yield* plan(actor, input)
        return { changes: result.changes, problems: result.problems, digest: result.digest, lock: result.lock }
      }),
      apply: Effect.fn("InfraSpecs.apply")(function* (actor: Actor.Info, input: Infra.ApplyInput) {
        yield* authorize(actor, InfraPolicy.actions.apply)
        const result = yield* plan(actor, input)
        if (result.problems.length > 0)
          return yield* new Primitive.Invalid({ message: "The plan has problems. Run ren infra plan to see them." })
        if (result.digest !== input.digest)
          return yield* new Primitive.Conflict({ message: "The plan is stale. Run ren infra plan again." })
        const conflicts = result.changes.filter((change) => change.status === "conflict")
        if (conflicts.length > 0 && !input.force)
          return yield* new Primitive.Conflict({
            message: `${conflicts.map((change) => change.path).join(", ")} changed in Ren and in the folder. Pull and merge them, or apply with force.`,
          })
        yield* Effect.forEach(
          result.steps.filter((entry) => entry.verdict === "apply" || entry.verdict === "conflict"),
          (entry) => entry.step.run.pipe(at(entry.step.change.path)),
          { discard: true },
        )
        const after = yield* load(actor, input)
        const settled = liveResources(after, diff(actor, after, input).aliases)
        return {
          changes: result.changes.filter((change) => change.status !== "changed" && change.status !== "new"),
          lock: {
            organization: after.organization.slug,
            resources: InfraVersions.next(
              InfraVersions.versions(folderResources(input.spec, input.bindings, settled)),
              InfraVersions.versions(settled),
              result.seen,
            ),
          },
        }
      }),
    })
  }),
)
