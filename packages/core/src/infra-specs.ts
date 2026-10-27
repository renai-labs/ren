export * as InfraSpecs from "./infra-specs.js"

import { Database } from "@ren/db/database"
import type { Agent as AgentSchema } from "@ren/schema/agent"
import { Infra } from "@ren/schema/infra"
import { Settings } from "@ren/schema/settings"
import type { Space as SpaceSchema } from "@ren/schema/space"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Context, Effect, Layer, Predicate, Schema } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { Agent } from "./agent.js"
import { AgentMembership } from "./agent/membership.js"
import { AppValidation } from "./app/validation.js"
import { InfraPolicy } from "./infra-specs/policy.js"
import { OrganizationSettings } from "./organization-settings.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"
import { SpaceQueries } from "./space/queries.js"
import { SpaceSettings } from "./space/settings.js"
import { SettingsRows } from "./settings/rows.js"

type Failure = Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict | Primitive.Invalid

export interface Interface {
  readonly pull: (actor: Actor.Info) => Effect.Effect<Infra.Pulled, Primitive.Forbidden>
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
  readonly apps: ReadonlyArray<{ readonly ownerSpaceId: SpaceSchema.ID | null; readonly slug: string }>
}

interface Step {
  readonly change: Infra.Change
  readonly run: Effect.Effect<unknown, Failure>
}

const unsupported = ["apps", "schedules", "webhooks", "channels"] as const

const sameSettings = Schema.toEquivalence(Settings.Info)

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

const changed = (fields: Record<string, boolean>) => Object.keys(fields).filter((field) => fields[field])

const step = (
  action: Infra.Change["action"],
  kind: Infra.Change["kind"],
  path: string,
  run: Effect.Effect<unknown, Failure>,
  more: { readonly fields?: ReadonlyArray<string>; readonly from?: string } = {},
): Step => ({
  change: { action, kind, path, fields: more.fields ?? [], ...(more.from && { from: more.from }) },
  run,
})

const byPath = (left: Step, right: Step) => left.change.path.localeCompare(right.change.path)

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

    const authorize = (actor: Actor.Info, action: string) =>
      access.isAllowed({ actor, action, resource: Access.organization })
        ? Effect.void
        : Effect.fail(new Primitive.Forbidden({ message: "Only organization admins can use the org spec." }))

    const load = (actor: Actor.Info) =>
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
            const apps = yield* transaction
              .select({ ownerSpaceId: Database.Schema.app.owner_space_id, slug: Database.Schema.app.slug })
              .from(Database.Schema.app)
              .where(
                and(
                  eq(Database.Schema.app.organization_id, actor.organizationId),
                  isNull(Database.Schema.app.archived_at),
                ),
              )
              .orderBy(asc(Database.Schema.app.slug))
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
              apps,
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
      }
    }

    const digest = (live: Live, input: Infra.PlanInput) =>
      Schema.encodeEffect(Infra.PlanInput)(input).pipe(
        Effect.orDie,
        Effect.map((encoded) =>
          new Bun.CryptoHasher("sha256").update(AppValidation.canonical({ live, input: encoded })).digest("hex"),
        ),
      )

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
          const apps = live.apps.filter((app) => app.ownerSpaceId === space.id).map((app) => app.slug)
          if (apps.length > 0)
            problems.push({
              path: `spaces/${space.slug}`,
              message: `This space owns apps ${apps.join(", ")}. Move or archive them in the app first.`,
            })
          return step("archive", "space", `spaces/${space.slug}`, spaces.archive(actor, space.id))
        })

      const steps = [
        ...organization,
        ...spaceSteps.toSorted(byPath),
        ...agentSteps.toSorted(byPath),
        ...membershipCreates.toSorted(byPath),
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
      if (Object.keys(input.bindings.spaces).length > 0)
        problems.push({ path: "deploy.yaml", message: "Infra does not apply the bindings of spaces yet." })
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
      }
    }

    const plan = Effect.fnUntraced(function* (actor: Actor.Info, input: Infra.PlanInput) {
      const live = yield* load(actor)
      const planned = diff(actor, live, input)
      return { live, planned, digest: yield* digest(live, input) }
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
      pull: Effect.fn("InfraSpecs.pull")(function* (actor: Actor.Info) {
        yield* authorize(actor, InfraPolicy.actions.pull)
        const live = yield* load(actor)
        const inScope = scope(live)
        const names = new Map(inScope.owned.map((agent) => [agent.id, agent.name]))
        return {
          bindings: { organization: live.organization.slug },
          spec: {
            org: { settings: live.organization.settings },
            spaces: Object.fromEntries(
              inScope.shared.map((space) => [
                space.slug,
                {
                  name: space.name,
                  ...(Predicate.isNotNull(space.description) && { description: space.description }),
                  settings: space.settings,
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
      }),
      plan: Effect.fn("InfraSpecs.plan")(function* (actor: Actor.Info, input: Infra.PlanInput) {
        yield* authorize(actor, InfraPolicy.actions.plan)
        const result = yield* plan(actor, input)
        return {
          changes: result.planned.steps.map((planned) => planned.change),
          problems: result.planned.problems,
          digest: result.digest,
        }
      }),
      apply: Effect.fn("InfraSpecs.apply")(function* (actor: Actor.Info, input: Infra.ApplyInput) {
        yield* authorize(actor, InfraPolicy.actions.apply)
        const result = yield* plan(actor, input)
        if (result.planned.problems.length > 0)
          return yield* new Primitive.Invalid({ message: "The plan has problems. Run ren infra plan to see them." })
        if (result.digest !== input.digest)
          return yield* new Primitive.Conflict({ message: "The plan is stale. Run ren infra plan again." })
        yield* Effect.forEach(result.planned.steps, (planned) => planned.run.pipe(at(planned.change.path)), {
          discard: true,
        })
        return { changes: result.planned.steps.map((planned) => planned.change) }
      }),
    })
  }),
)
