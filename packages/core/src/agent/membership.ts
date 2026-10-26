export * as AgentMembership from "./membership.js"

import { Database } from "@ren/db/database"
import { Agent } from "@ren/schema/agent"
import { AgentMembership } from "@ren/schema/agent-membership"
import type { Space } from "@ren/schema/space"
import { and, asc, count, eq, isNull, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option } from "effect"
import { Access } from "../access.js"
import type { Actor } from "../actor.js"
import { Primitive } from "../primitive.js"
import { AgentPolicy } from "./policy.js"
import { AgentQueries } from "./queries.js"

export type Interface = Primitive.Interface<typeof AgentMembership.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/AgentMembership") {}

const notFound = new Primitive.NotFound({ message: "Agent membership not found." })

const agentNotFound = new Primitive.NotFound({ message: "Agent not found." })

const actions = {
  list: Primitive.action(AgentMembership.definition, "list"),
  create: Primitive.action(AgentMembership.definition, "create"),
  archive: Primitive.action(AgentMembership.definition, "archive"),
  getAgent: Primitive.action(Agent.definition, "get"),
}

const entry = (row: {
  readonly membershipId: AgentMembership.ID | null
  readonly agentId: Agent.ID
  readonly spaceId: Space.ID
  readonly createdAt: Date
}): AgentMembership.Info => ({
  id: row.membershipId ?? AgentMembership.ofOwner(row.agentId),
  spaceId: row.spaceId,
  agentId: row.agentId,
  isOwner: !row.membershipId,
  createdAt: DateTime.fromDateUnsafe(row.createdAt),
})

const rowEntry = (row: typeof Database.Schema.agent_membership.$inferSelect) =>
  entry({ membershipId: row.id, agentId: row.agent_id, spaceId: row.space_id, createdAt: row.created_at })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const findAgent = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      agentId: Agent.ID,
    ) {
      const row = (yield* AgentQueries.select(transaction, actor)
        .where(
          and(
            eq(Database.Schema.agent.id, agentId),
            eq(Database.Schema.agent.organization_id, actor.organizationId),
            isNull(Database.Schema.agent.archived_at),
          ),
        )
        .for("update", { of: Database.Schema.agent })).at(0)
      if (!row) return yield* agentNotFound
      const holds = { isOwnerMember: row.isOwnerMember, isSpaceMember: row.isSpaceMember }
      if (!access.isAllowed({ actor, action: actions.getAgent, resource: AgentPolicy.resource(holds) }))
        return yield* agentNotFound
      return { agent: row.agent, holds }
    })

    return Service.of({
      list: Effect.fn("AgentMembership.list")(function* (actor: Actor.Info, input: AgentMembership.ListInput) {
        const page = { page: input.page, pageSize: input.pageSize }
        const visible = and(
          eq(Database.Schema.agent.organization_id, actor.organizationId),
          isNull(Database.Schema.agent.archived_at),
          Access.where(access.plan(actor, actions.list), AgentQueries.where(actor)),
          input.agentId ? eq(Database.Schema.agent.id, input.agentId) : undefined,
        )
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const entries = () =>
              transaction
                .select({
                  membershipId: sql<AgentMembership.ID | null>`null`.as("membership_id"),
                  agentId: sql<Agent.ID>`${Database.Schema.agent.id}`.as("agent_id"),
                  spaceId: sql<Space.ID>`${Database.Schema.agent.owner_space_id}`.as("space_id"),
                  createdAt: Database.Schema.agent.created_at,
                })
                .from(Database.Schema.agent)
                .where(
                  and(visible, input.spaceId ? eq(Database.Schema.agent.owner_space_id, input.spaceId) : undefined),
                )
                .unionAll(
                  transaction
                    .select({
                      membershipId: Database.Schema.agent_membership.id,
                      agentId: Database.Schema.agent_membership.agent_id,
                      spaceId: Database.Schema.agent_membership.space_id,
                      createdAt: Database.Schema.agent_membership.created_at,
                    })
                    .from(Database.Schema.agent_membership)
                    .innerJoin(
                      Database.Schema.agent,
                      eq(Database.Schema.agent.id, Database.Schema.agent_membership.agent_id),
                    )
                    .where(
                      and(
                        visible,
                        input.spaceId ? eq(Database.Schema.agent_membership.space_id, input.spaceId) : undefined,
                      ),
                    ),
                )
            const rows = yield* entries()
              .orderBy(asc(sql`created_at`), asc(sql`agent_id`), sql`membership_id asc nulls first`)
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction.select({ total: count() }).from(entries().as("entries"))
            return { items: rows.map(entry), ...page, total: totals.at(0)?.total ?? 0 }
          }),
        )
      }),
      create: Effect.fn("AgentMembership.create")(function* (actor: Actor.Info, input: AgentMembership.CreateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = yield* findAgent(transaction, actor, input.agentId)
            const target = yield* AgentQueries.visibleSpace(transaction, actor, input.spaceId)
            if (
              !access.isAllowed({
                actor,
                action: actions.create,
                resource: AgentPolicy.resource({ ...found.holds, isTargetMember: target.isMember }),
              })
            )
              return yield* new Primitive.Forbidden({
                message: "Adding an agent to a space needs membership in both spaces, or an organization admin.",
              })
            if (found.agent.owner_space_id === input.spaceId)
              return entry({
                membershipId: null,
                agentId: found.agent.id,
                spaceId: input.spaceId,
                createdAt: found.agent.created_at,
              })
            const inserted = yield* transaction
              .insert(Database.Schema.agent_membership)
              .values({ id: AgentMembership.ID.create(), agent_id: input.agentId, space_id: input.spaceId })
              .onConflictDoNothing()
              .returning()
            const row =
              inserted.at(0) ??
              (yield* transaction
                .select()
                .from(Database.Schema.agent_membership)
                .where(
                  and(
                    eq(Database.Schema.agent_membership.agent_id, input.agentId),
                    eq(Database.Schema.agent_membership.space_id, input.spaceId),
                  ),
                )).at(0)
            if (!row) return yield* Effect.die(new Error("The agent membership is missing after its insert"))
            return rowEntry(row)
          }),
        )
      }),
      archive: Effect.fn("AgentMembership.archive")(function* (actor: Actor.Info, id: AgentMembership.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const owner = AgentMembership.ownerAgent(id)
            if (Option.isSome(owner)) {
              yield* findAgent(transaction, actor, owner.value).pipe(Effect.mapError(() => notFound))
              return yield* new Primitive.Conflict({
                message: "The owner space cannot remove its agent. Move the agent to another space first.",
              })
            }
            const row = (yield* transaction
              .select()
              .from(Database.Schema.agent_membership)
              .where(eq(Database.Schema.agent_membership.id, id))
              .for("update")).at(0)
            if (!row) return yield* notFound
            const found = yield* findAgent(transaction, actor, row.agent_id).pipe(Effect.mapError(() => notFound))
            const isTargetMember = yield* AgentQueries.isMember(transaction, row.space_id, actor.userId)
            if (
              !access.isAllowed({
                actor,
                action: actions.archive,
                resource: AgentPolicy.resource({ ...found.holds, isTargetMember }),
              })
            )
              return yield* new Primitive.Forbidden({ message: "You cannot remove this agent from this space." })
            yield* transaction
              .delete(Database.Schema.agent_membership)
              .where(eq(Database.Schema.agent_membership.id, id))
            return rowEntry(row)
          }),
        )
      }),
    })
  }),
)
