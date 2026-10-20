export * as Agent from "./agent.js"

import { Database } from "@ren/db/database"
import { Agent } from "@ren/schema/agent"
import { AgentMembership } from "@ren/schema/agent-membership"
import { Settings } from "@ren/schema/settings"
import { and, asc, count, eq, isNull, sql, type SQL } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Predicate, Schema } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { AgentDefaults } from "./agent/defaults.js"
import { AgentPolicy } from "./agent/policy.js"
import { AgentQueries } from "./agent/queries.js"
import { Primitive } from "./primitive.js"
import { SettingsRows } from "./settings/rows.js"

export type Interface = Primitive.Interface<typeof Agent.definition>

export class Service extends Context.Service<Service, Interface>()("@ren/core/Agent") {}

const notFound = new Primitive.NotFound({ message: "Agent not found." })

const actions = {
  list: Primitive.action(Agent.definition, "list"),
  get: Primitive.action(Agent.definition, "get"),
  create: Primitive.action(Agent.definition, "create"),
  update: Primitive.action(Agent.definition, "update"),
  archive: Primitive.action(Agent.definition, "archive"),
  transferOwnership: Primitive.action(Agent.definition, "transferOwnership"),
}

const select = (transaction: Database.Transaction, actor: Actor.Info) =>
  transaction
    .select({
      agent: Database.Schema.agent,
      settings: Database.Schema.settings,
      isOwnerMember: AgentQueries.isOwnerMember(actor),
      isSpaceMember: AgentQueries.isSpaceMember(actor),
    })
    .from(Database.Schema.agent)
    .leftJoin(Database.Schema.settings, eq(Database.Schema.settings.owner_id, Database.Schema.agent.id))

type Row = Effect.Success<ReturnType<typeof select>>[number]

const settingsOf = (row: Row) => Effect.map(SettingsRows.decode(row.settings), (decoded) => decoded.settings)

const toInfo = (agent: typeof Database.Schema.agent.$inferSelect, settings: Settings.Info) =>
  Schema.decodeUnknownEffect(Agent.Info)({
    id: agent.id,
    organizationId: agent.organization_id,
    ownerSpaceId: agent.owner_space_id,
    name: agent.name,
    description: agent.description,
    isSubagent: agent.is_subagent,
    settings,
    createdAt: DateTime.fromDateUnsafe(agent.created_at),
    updatedAt: DateTime.fromDateUnsafe(agent.updated_at),
    archivedAt: agent.archived_at && DateTime.fromDateUnsafe(agent.archived_at),
  }).pipe(Effect.orDie)

const rowInfo = (row: Row) => Effect.flatMap(settingsOf(row), (settings) => toInfo(row.agent, settings))

const refused = (input: { readonly name: string; readonly isSubagent: boolean; readonly settings: Settings.Info }) =>
  [
    AgentDefaults.reserved.has(input.name) && `The name ${input.name} is reserved.`,
    input.isSubagent && input.settings.references.length > 0 && "A subagent cannot have references.",
  ].find(Predicate.isString)

const nameTaken = (name: string) =>
  Primitive.uniqueConflict(Database.Schema.agentNameConstraint, `An agent named ${name} already exists.`)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service

    const visibleTo = (actor: Actor.Info) => {
      const plan = access.plan(actor, actions.get)
      if (plan.isAllowedEverywhere) return
      return plan.allowedWhere.length > 0 ? AgentQueries.isSpaceMember(actor) : sql`false`
    }

    const resource = (row: Row, target: { readonly isTargetMember?: boolean } = {}) =>
      AgentPolicy.resource({ isOwnerMember: row.isOwnerMember, isSpaceMember: row.isSpaceMember, ...target })

    const findLive = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      where: SQL | undefined,
    ) {
      const row = (yield* select(transaction, actor)
        .where(
          and(
            where,
            eq(Database.Schema.agent.organization_id, actor.organizationId),
            isNull(Database.Schema.agent.archived_at),
          ),
        )
        .for("update", { of: Database.Schema.agent })).at(0)
      if (!row || !access.isAllowed({ actor, action: actions.get, resource: resource(row) })) return yield* notFound
      return row
    })

    return Service.of({
      list: Effect.fn("Agent.list")(function* (actor: Actor.Info, input: Agent.ListInput) {
        const where = and(
          eq(Database.Schema.agent.organization_id, actor.organizationId),
          isNull(Database.Schema.agent.archived_at),
          visibleTo(actor),
          input.spaceId ? AgentQueries.isInSpace(input.spaceId) : undefined,
          Predicate.isBoolean(input.isSubagent) ? eq(Database.Schema.agent.is_subagent, input.isSubagent) : undefined,
        )
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* select(transaction, actor)
              .where(where)
              .orderBy(asc(Database.Schema.agent.created_at), asc(Database.Schema.agent.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction.select({ total: count() }).from(Database.Schema.agent).where(where)
            return {
              items: yield* Effect.forEach(rows, rowInfo),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),
      get: Effect.fn("Agent.get")(function* (actor: Actor.Info, idOrSlug: string) {
        return yield* database.transaction((transaction) =>
          findLive(
            transaction,
            actor,
            Schema.is(Agent.ID)(idOrSlug)
              ? eq(Database.Schema.agent.id, idOrSlug)
              : eq(Database.Schema.agent.name, idOrSlug),
          ).pipe(Effect.flatMap(rowInfo)),
        )
      }),
      create: Effect.fn("Agent.create")(function* (actor: Actor.Info, input: Agent.CreateInput) {
        const reason = refused(input)
        if (reason) return yield* new Primitive.Conflict({ message: reason })
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const space = yield* AgentQueries.visibleSpace(transaction, access, actor, input.ownerSpaceId)
            if (
              !access.isAllowed({
                actor,
                action: actions.create,
                resource: AgentPolicy.resource({
                  isOwnerMember: false,
                  isSpaceMember: false,
                  isTargetMember: space.isMember,
                }),
              })
            )
              return yield* new Primitive.Forbidden({ message: "You cannot create agents in this space." })
            const rows = yield* transaction
              .insert(Database.Schema.agent)
              .values({
                id: Agent.ID.create(),
                organization_id: actor.organizationId,
                owner_space_id: input.ownerSpaceId,
                name: input.name,
                description: input.description ?? null,
                is_subagent: input.isSubagent,
              })
              .returning()
              .pipe(Effect.catchTag("EffectDrizzleQueryError", nameTaken(input.name)))
            const agent = rows.at(0)
            if (!agent) return yield* Effect.die(new Error("The agent insert returned no row"))
            yield* SettingsRows.write(transaction, { agent_id: agent.id }, input.settings)
            return yield* toInfo(agent, input.settings)
          }),
        )
      }),
      update: Effect.fn("Agent.update")(function* (actor: Actor.Info, id: Agent.ID, input: Agent.UpdateInput) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* findLive(transaction, actor, eq(Database.Schema.agent.id, id))
            if (!access.isAllowed({ actor, action: actions.update, resource: resource(row) }))
              return yield* new Primitive.Forbidden({ message: "Only members of the owner space can edit this agent." })
            const next = {
              name: input.name ?? row.agent.name,
              isSubagent: input.isSubagent ?? row.agent.is_subagent,
              settings: input.settings ?? (yield* settingsOf(row)),
            }
            const reason = refused(next)
            if (reason) return yield* new Primitive.Conflict({ message: reason })
            const rows = yield* transaction
              .update(Database.Schema.agent)
              .set({
                name: next.name,
                description: input.description,
                is_subagent: next.isSubagent,
                updated_at: sql`now()`,
              })
              .where(eq(Database.Schema.agent.id, id))
              .returning()
              .pipe(Effect.catchTag("EffectDrizzleQueryError", nameTaken(next.name)))
            const agent = rows.at(0)
            if (!agent) return yield* notFound
            if (input.settings) yield* SettingsRows.write(transaction, { agent_id: id }, input.settings)
            return yield* toInfo(agent, next.settings)
          }),
        )
      }),
      archive: Effect.fn("Agent.archive")(function* (actor: Actor.Info, id: Agent.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* findLive(transaction, actor, eq(Database.Schema.agent.id, id))
            if (!access.isAllowed({ actor, action: actions.archive, resource: resource(row) }))
              return yield* new Primitive.Forbidden({
                message: "Only members of the owner space can archive this agent.",
              })
            yield* transaction
              .delete(Database.Schema.agent_membership)
              .where(eq(Database.Schema.agent_membership.agent_id, id))
            const rows = yield* transaction
              .update(Database.Schema.agent)
              .set({ archived_at: sql`now()`, updated_at: sql`now()` })
              .where(eq(Database.Schema.agent.id, id))
              .returning()
            const agent = rows.at(0)
            if (!agent) return yield* notFound
            return yield* toInfo(agent, yield* settingsOf(row))
          }),
        )
      }),
      transferOwnership: Effect.fn("Agent.transferOwnership")(function* (
        actor: Actor.Info,
        id: Agent.ID,
        input: Agent.TransferOwnershipInput,
      ) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* findLive(transaction, actor, eq(Database.Schema.agent.id, id))
            const target = yield* AgentQueries.visibleSpace(transaction, access, actor, input.spaceId)
            if (
              !access.isAllowed({
                actor,
                action: actions.transferOwnership,
                resource: resource(row, { isTargetMember: target.isMember }),
              })
            )
              return yield* new Primitive.Forbidden({
                message: "Moving an agent needs membership in both spaces, or an organization admin.",
              })
            const ownerSpaceId = row.agent.owner_space_id
            if (!ownerSpaceId) return yield* notFound
            if (ownerSpaceId === input.spaceId) return yield* rowInfo(row)
            yield* transaction
              .delete(Database.Schema.agent_membership)
              .where(
                and(
                  eq(Database.Schema.agent_membership.agent_id, id),
                  eq(Database.Schema.agent_membership.space_id, input.spaceId),
                ),
              )
            yield* transaction
              .insert(Database.Schema.agent_membership)
              .values({ id: AgentMembership.ID.create(), agent_id: id, space_id: ownerSpaceId })
              .onConflictDoNothing()
            const rows = yield* transaction
              .update(Database.Schema.agent)
              .set({ owner_space_id: input.spaceId, updated_at: sql`now()` })
              .where(eq(Database.Schema.agent.id, id))
              .returning()
            const agent = rows.at(0)
            if (!agent) return yield* notFound
            return yield* toInfo(agent, yield* settingsOf(row))
          }),
        )
      }),
    })
  }),
)
