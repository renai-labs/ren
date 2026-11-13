export * as Space from "./space.js"

import { Database } from "@ren/db/database"
import { Agent } from "@ren/schema/agent"
import type { MachineTemplate } from "@ren/schema/machine-template"
import { Factory } from "@ren/schema/factory"
import { FactoryCheck } from "@ren/schema/factory-check"
import { Space } from "@ren/schema/space"
import { SpaceMember } from "@ren/schema/space-member"
import { and, asc, count, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Access } from "./access.js"
import { CredentialOffboarding } from "./credential/offboarding.js"
import { EgressControl } from "./egress-control.js"
import { AppQueries } from "./app/queries.js"
import { BrainProvider } from "./brain-provider.js"
import { Actor } from "./actor.js"
import { AgentQueries } from "./agent/queries.js"
import { Primitive } from "./primitive.js"
import { SpacePolicy } from "./space/policy.js"
import { SpaceQueries } from "./space/queries.js"
import { TaskFactory } from "./task/factory.js"

export interface Interface extends Primitive.Interface<typeof Space.definition> {
  readonly changeSlug: (
    actor: Actor.Info,
    id: Space.ID,
    slug: string,
  ) => Effect.Effect<Space.Info, Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Space") {}

const notFound = new Primitive.NotFound({ message: "Space not found." })

const memberCount = sql<number>`(
  select count(*)::int from ${Database.Schema.space_member}
  where ${Database.Schema.space_member.space_id} = ${Database.Schema.space.id}
    and ${Database.Schema.space_member.archived_at} is null
)`

const firstSpace = alias(Database.Schema.space, "first_space")

const isFirstOrganizationSpace = sql<boolean>`${Database.Schema.space.id} = (
  select ${firstSpace.id} from ${Database.Schema.space} as ${firstSpace}
  where ${firstSpace.organization_id} = ${Database.Schema.space.organization_id}
  order by ${firstSpace.created_at}, ${firstSpace.id}
  limit 1
)`

// oxlint-disable-next-line ren/no-comments -- A brain with a machine that applied an older brain or hand setting, or that runs another image than its template's last build.
const isComputePending = sql<boolean>`exists (
  select 1 from ${Database.Schema.brain}
  left join ${Database.Schema.environment_template} on ${Database.Schema.environment_template.id} = ${Database.Schema.space.brain_template_id}
  where ${Database.Schema.brain.space_id} = ${Database.Schema.space.id}
    and ${Database.Schema.brain.binding} is not null
    and (${Database.Schema.brain.compute_revision} < ${Database.Schema.space.compute_revision}
      or (${Database.Schema.environment_template.image} is not null and ${Database.Schema.brain.image} is distinct from ${Database.Schema.environment_template.image}))
)`

const select = (transaction: Database.Transaction, actor: Actor.Info) =>
  transaction
    .select({
      space: Database.Schema.space,
      membershipId: SpaceQueries.membership.id,
      isFirstOrganizationSpace,
      memberCount,
      joinRequestId: sql<Space.JoinRequestID | null>`(
        select ${Database.Schema.space_join_request.id} from ${Database.Schema.space_join_request}
        where ${Database.Schema.space_join_request.space_id} = ${Database.Schema.space.id}
          and ${Database.Schema.space_join_request.user_id} = ${actor.userId}
          and ${Database.Schema.space_join_request.status} = 'pending'
      )`,
      isComputePending,
      usable: AgentQueries.factoryOrder,
    })
    .from(Database.Schema.space)
    .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))

type Row = Effect.Success<ReturnType<typeof select>>[number]

const actions = {
  ...SpacePolicy.actions,
  addMember: Primitive.action(SpaceMember.definition, "create"),
  removeMember: Primitive.action(SpaceMember.definition, "archive"),
  requestJoin: SpacePolicy.joinRequestActions.create,
}

// oxlint-disable-next-line ren/no-comments -- A space runs only machines that can run: a built template of its organization, for its brain one of its brain provider. The template read waits for an archive of it.
const checkTemplate = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  actor: Actor.Info,
  templateId: MachineTemplate.ID,
  field: "brain" | "hand",
) {
  const template = (yield* transaction
    .select({
      provider: Database.Schema.environment_template.provider,
      image: Database.Schema.environment_template.image,
      buildStatus: Database.Schema.environment_template.build_status,
    })
    .from(Database.Schema.environment_template)
    .where(
      and(
        eq(Database.Schema.environment_template.id, templateId),
        eq(Database.Schema.environment_template.organization_id, actor.organizationId),
        isNull(Database.Schema.environment_template.archived_at),
      ),
    )
    .for("share")).at(0)
  if (!template)
    return yield* new Primitive.Invalid({
      message: `This organization has no environment template ${templateId}`,
      field,
    })
  // oxlint-disable-next-line ren/no-comments -- A provider that builds no image is ready at once.
  if (!template.image && template.buildStatus !== "ready")
    return yield* new Primitive.Invalid({
      message:
        template.buildStatus === "failed"
          ? `The environment template ${templateId} has no image: its build failed. Fix the template and save it again.`
          : `The environment template ${templateId} has no image yet; wait until its build is ready`,
      field,
    })
  return template.provider
})

// oxlint-disable-next-line ren/no-comments -- The brain's provider must be one this deployment registers, and its template one of that provider. Returns the provider.
const checkBrain = Effect.fnUntraced(function* (
  registry: BrainProvider.Registry["Service"],
  transaction: Database.Transaction,
  actor: Actor.Info,
  brain: Space.BrainMachine,
) {
  const provider = Option.flatMap(Option.fromNullishOr(brain.provider), registry.get)
  if (brain.provider && Option.isNone(provider))
    return yield* new Primitive.Invalid({
      message: `This deployment has no brain provider ${brain.provider}`,
      field: "brain",
    })
  if (!brain.environmentTemplateId) return provider
  const templateProvider = yield* checkTemplate(transaction, actor, brain.environmentTemplateId, "brain")
  if (templateProvider !== brain.provider)
    return yield* new Primitive.Invalid({
      message: `The brain needs a template of its provider ${brain.provider ?? "(none)"}, not of ${templateProvider}`,
      field: "brain",
    })
  return provider
})

const checkMachines = Effect.fnUntraced(function* (
  registry: BrainProvider.Registry["Service"],
  transaction: Database.Transaction,
  actor: Actor.Info,
  input: Pick<Space.UpdateInput, "brain" | "hand">,
  current: { readonly brain: Space.BrainMachine; readonly hand: Space.Hand },
) {
  if (!input.brain && !input.hand) return
  const hand = input.hand ?? current.hand
  const brainProvider = yield* checkBrain(registry, transaction, actor, input.brain ?? current.brain)
  if (hand.placement === "colocated" && Option.exists(brainProvider, (provider) => !provider.info.canColocate))
    return yield* new Primitive.Invalid({
      message: `The brain provider ${Option.getOrThrow(brainProvider).info.id} cannot run tools on the brain’s machine; pick a remote hand or none`,
      field: "hand",
    })
  if (hand.placement === "remote") yield* checkTemplate(transaction, actor, hand.environmentTemplateId, "hand")
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* BrainProvider.Registry
    const deploymentProvider = Option.getOrNull(
      Option.map(BrainProvider.defaultOf(registry), (provider) => provider.info.id),
    )
    const database = yield* Database.Service
    const access = yield* Access.Service
    const control = yield* EgressControl.Service

    const visibleTo = (actor: Actor.Info) =>
      and(
        eq(Database.Schema.space.organization_id, actor.organizationId),
        isNull(Database.Schema.space.archived_at),
        Access.where(access.plan(actor, actions.get), SpaceQueries.where),
      )

    const resourceOf = (actor: Actor.Info, row: Pick<Row, "membershipId" | "space" | "isFirstOrganizationSpace">) =>
      SpacePolicy.resource({
        membershipId: row.membershipId,
        kind: row.space.kind,
        isOwner: row.space.owner_user_id === actor.userId,
        isFirst: row.isFirstOrganizationSpace,
      })

    // oxlint-disable-next-line ren/no-comments -- private-spaces rule 7: no `read`, list entry only. A shared space shows its description to every member of the organization; its factory needs `read`.
    const toInfo =
      (actor: Actor.Info) =>
      (row: Row): Space.Info => {
        const resource = resourceOf(actor, row)
        const isAllowed = (action: string) => access.isAllowed({ actor, action, resource })
        const canRead = isAllowed(actions.read)
        return {
          id: row.space.id,
          organizationId: row.space.organization_id,
          kind: row.space.kind,
          ownerUserId: row.space.owner_user_id,
          slug: row.space.slug,
          name: row.space.name,
          description: canRead || row.space.kind === "shared" ? row.space.description : null,
          brainScope: row.space.brain_scope,
          brain: SpaceQueries.brainMachine(row.space, deploymentProvider),
          hand: SpaceQueries.hand(row.space),
          compute: {
            isPending: row.isComputePending,
            shutdown: row.space.shutdown_state,
            lastShutdown: row.space.shutdown_report && {
              finishedAt: DateTime.makeUnsafe(row.space.shutdown_report.finishedAt),
              problems: row.space.shutdown_report.problems,
            },
          },
          memberCount: row.memberCount,
          membershipId: row.membershipId,
          factory: canRead ? TaskFactory.keep(row.space.factory, row.usable) : Factory.empty,
          canUpdate: isAllowed(actions.update),
          canJoin: isAllowed(actions.join),
          canRequestJoin: !row.joinRequestId && isAllowed(actions.requestJoin),
          joinRequestId: row.joinRequestId,
          canAddMember: isAllowed(actions.addMember),
          canRemoveMember: isAllowed(actions.removeMember),
          canArchive: isAllowed(actions.archive),
          createdAt: DateTime.fromDateUnsafe(row.space.created_at),
          updatedAt: DateTime.fromDateUnsafe(row.space.updated_at),
          archivedAt: row.space.archived_at && DateTime.fromDateUnsafe(row.space.archived_at),
        }
      }

    const find = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      where: SQL | undefined,
    ) {
      const info = (yield* select(transaction, actor).where(where)).map(toInfo(actor)).at(0)
      if (!info) return yield* notFound
      return info
    })

    const findVisible = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: Space.ID,
    ) {
      const rows = yield* select(transaction, actor)
        .where(and(eq(Database.Schema.space.id, id), eq(Database.Schema.space.organization_id, actor.organizationId)))
        .for("update", { of: Database.Schema.space })
      const row = rows.at(0)
      if (!row) return
      const resource = resourceOf(actor, row)
      if (!access.isAllowed({ actor, action: actions.get, resource })) return
      return { row, resource }
    })

    return Service.of({
      list: Effect.fn("Space.list")(function* (actor: Actor.Info, input: Space.ListInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            if (!access.isAllowed({ actor, action: actions.list, resource: Access.organization })) {
              return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
            }
            const where = and(visibleTo(actor), input.joined ? isNotNull(SpaceQueries.membership.id) : undefined)
            const rows = yield* select(transaction, actor)
              .where(where)
              .orderBy(asc(Database.Schema.space.created_at), asc(Database.Schema.space.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(Database.Schema.space)
              .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
              .where(where)
            return {
              items: rows.map(toInfo(actor)),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      get: Effect.fn("Space.get")(function* (actor: Actor.Info, idOrSlug: string) {
        const where = Schema.is(Space.ID)(idOrSlug)
          ? eq(Database.Schema.space.id, idOrSlug)
          : eq(Database.Schema.space.slug, idOrSlug)
        return yield* database.transaction((transaction) => find(transaction, actor, and(visibleTo(actor), where)))
      }),
      create: Effect.fn("Space.create")(function* (actor: Actor.Info, input: Space.CreateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            if (!access.isAllowed({ actor, action: actions.create, resource: Access.organization })) {
              return yield* new Primitive.Forbidden({ message: "Join the organization to create spaces." })
            }
            const id = Space.ID.create()
            yield* transaction.insert(Database.Schema.space).values({
              id,
              organization_id: actor.organizationId,
              slug: yield* Primitive.slugFor(
                input,
                "space",
                yield* SpaceQueries.slugs(transaction, actor.organizationId),
              ),
              name: input.name,
              description: input.description ?? null,
            })
            yield* transaction
              .insert(Database.Schema.space_member)
              .values({ id: Space.MembershipID.create(), space_id: id, user_id: actor.userId })
            return yield* find(transaction, actor, eq(Database.Schema.space.id, id))
          }),
        )
      }),
      update: Effect.fn("Space.update")(function* (actor: Actor.Info, id: Space.ID, input: Space.UpdateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const visible = yield* findVisible(transaction, actor, id)
            if (!visible || visible.row.space.archived_at) return yield* notFound
            if (!access.isAllowed({ actor, action: actions.update, resource: visible.resource })) {
              return yield* new Primitive.Forbidden({ message: "You cannot edit this space." })
            }
            const current = SpaceQueries.machines(visible.row.space, deploymentProvider)
            yield* checkMachines(registry, transaction, actor, input, current)
            if (input.factory) {
              const problem = FactoryCheck.problems(input.factory).at(0)
              if (problem) return yield* new Primitive.Invalid({ message: problem, field: "factory" })
              const ids = input.factory.agents.map((entry) => entry.agentId)
              const usable = yield* transaction
                .select({ id: Database.Schema.agent.id })
                .from(Database.Schema.agent)
                .where(
                  and(
                    inArray(Database.Schema.agent.id, ids.filter(Schema.is(Agent.ID))),
                    AgentQueries.isUsableIn(id, actor.organizationId),
                  ),
                )
              if (usable.length !== ids.length)
                return yield* new Primitive.Invalid({
                  message: "Each agent in the factory must be usable in this space.",
                  field: "factory",
                })
            }
            const updated = yield* transaction
              .update(Database.Schema.space)
              .set({
                name: input.name,
                description: input.description,
                brain_scope: input.brainScope,
                ...(input.brain && SpaceQueries.brainColumns(input.brain)),
                ...(input.hand && SpaceQueries.handColumns(input.hand)),
                ...(SpaceQueries.isComputeChanged(current, input) && {
                  compute_revision: sql`${Database.Schema.space.compute_revision} + 1`,
                }),
                factory: input.factory,
                updated_at: sql`now()`,
              })
              .where(eq(Database.Schema.space.id, id))
              .returning()
            if (updated.length === 0) return yield* notFound
            return yield* find(transaction, actor, eq(Database.Schema.space.id, id))
          }),
        )
      }),
      changeSlug: Effect.fn("Space.changeSlug")(function* (actor: Actor.Info, id: Space.ID, slug: string) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const taken = yield* SpaceQueries.slugs(transaction, actor.organizationId)
            const visible = yield* findVisible(transaction, actor, id)
            if (!visible || visible.row.space.archived_at) return yield* notFound
            if (!access.isAllowed({ actor, action: actions.update, resource: visible.resource }))
              return yield* new Primitive.Forbidden({ message: "You cannot edit this space." })
            if (visible.row.space.slug !== slug) {
              if (taken.has(slug))
                return yield* new Primitive.Conflict({ message: `The slug “${slug}” is already taken.` })
              yield* transaction
                .update(Database.Schema.space)
                .set({ slug, updated_at: sql`now()` })
                .where(eq(Database.Schema.space.id, id))
            }
            return yield* find(transaction, actor, eq(Database.Schema.space.id, id))
          }),
        )
      }),
      // oxlint-disable-next-line ren/no-comments -- Marks the space for a shutdown under the next epoch; the API then starts its run (SpaceShutdown.start). Anyone who can edit the space can shut it down. A second request while one runs changes nothing.
      shutdown: Effect.fn("Space.shutdown")(function* (actor: Actor.Info, id: Space.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const visible = yield* findVisible(transaction, actor, id)
            if (!visible || visible.row.space.archived_at) return yield* notFound
            if (!access.isAllowed({ actor, action: actions.update, resource: visible.resource }))
              return yield* new Primitive.Forbidden({ message: "You cannot shut down this space." })
            if (!visible.row.space.shutdown_state)
              yield* transaction
                .update(Database.Schema.space)
                .set({
                  shutdown_state: "running",
                  shutdown_epoch: sql`${Database.Schema.space.shutdown_epoch} + 1`,
                  updated_at: sql`now()`,
                })
                .where(eq(Database.Schema.space.id, id))
            return yield* find(transaction, actor, eq(Database.Schema.space.id, id))
          }),
        )
      }),
      archive: Effect.fn("Space.archive")(function* (actor: Actor.Info, id: Space.ID) {
        const archived = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* AppQueries.lock(transaction, actor)
            const visible = yield* findVisible(transaction, actor, id)
            if (!visible) return yield* notFound
            if (visible.row.space.archived_at) return { info: toInfo(actor)(visible.row), removed: Option.none() }
            if (!access.isAllowed({ actor, action: actions.archive, resource: visible.resource }))
              return yield* new Primitive.Forbidden({ message: "This space cannot be archived." })
            if (visible.row.space.kind === "private") yield* SpaceQueries.archiveOwned(transaction, id)
            const owned = yield* transaction
              .select({ name: Database.Schema.agent.name })
              .from(Database.Schema.agent)
              .where(and(eq(Database.Schema.agent.owner_space_id, id), isNull(Database.Schema.agent.archived_at)))
              .orderBy(asc(Database.Schema.agent.name))
            if (owned.length > 0)
              return yield* new Primitive.Conflict({
                message: `This space owns ${owned.map((agent) => agent.name).join(", ")}. Move or archive them first.`,
              })
            const ownedApps = yield* transaction
              .select({ slug: Database.Schema.app.slug })
              .from(Database.Schema.app)
              .where(and(eq(Database.Schema.app.owner_space_id, id), isNull(Database.Schema.app.archived_at)))
              .orderBy(asc(Database.Schema.app.slug))
            if (ownedApps.length > 0)
              return yield* new Primitive.Conflict({
                message: `This space owns apps ${ownedApps.map((app) => app.slug).join(", ")}. Move or archive them first.`,
              })
            const archived = yield* transaction
              .update(Database.Schema.space)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(Database.Schema.space.id, id))
              .returning()
            yield* transaction
              .update(Database.Schema.space_pending_member)
              .set({ archived_at: sql`now()` })
              .where(
                and(
                  eq(Database.Schema.space_pending_member.space_id, id),
                  isNull(Database.Schema.space_pending_member.archived_at),
                ),
              )
            yield* SpaceQueries.cancelJoinRequests(transaction, eq(Database.Schema.space_join_request.space_id, id))
            yield* transaction
              .update(Database.Schema.space_invite_link)
              .set({ archived_at: sql`now()` })
              .where(
                and(
                  eq(Database.Schema.space_invite_link.space_id, id),
                  isNull(Database.Schema.space_invite_link.archived_at),
                ),
              )
            yield* transaction
              .delete(Database.Schema.channel_mapping)
              .where(eq(Database.Schema.channel_mapping.space_id, id))
            yield* transaction
              .update(Database.Schema.schedule)
              .set({ archived_at: sql`now()`, next_run_at: null, updated_at: sql`now()` })
              .where(and(eq(Database.Schema.schedule.space_id, id), isNull(Database.Schema.schedule.archived_at)))
            const space = archived.at(0)
            if (!space) return yield* notFound
            const removed = yield* CredentialOffboarding.forSpace(transaction, id)
            return { info: toInfo(actor)({ ...visible.row, space }), removed: Option.some(removed) }
          }),
        )
        if (Option.isSome(archived.removed))
          yield* CredentialOffboarding.invalidate(archived.removed.value).pipe(
            Effect.provideService(EgressControl.Service, control),
          )
        return archived.info
      }),
    })
  }),
)
