export * as TaskFactory from "./factory.js"

import { Database } from "@ren/db/database"
import { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Factory } from "@ren/schema/factory"
import type { Space } from "@ren/schema/space"
import type { Task } from "@ren/schema/task"
import { and, eq, inArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect, Predicate, Schema, Struct } from "effect"
import { AgentQueries } from "../agent/queries.js"
import { Primitive } from "../primitive.js"
import { TaskTrail } from "./trail.js"

export const keep = (factory: Factory.Info, usable: ReadonlyArray<string>): Factory.Info => {
  const allowed = new Set(usable)
  const kept = factory.agents.filter((entry) => allowed.has(entry.agentId))
  if (kept.length === 0) return { maxHandoffs: factory.maxHandoffs, agents: usable.map((agentId) => ({ agentId })) }
  return {
    maxHandoffs: factory.maxHandoffs,
    agents: kept.map((entry) =>
      Struct.evolve(entry, {
        to: (to) =>
          (to ?? [])
            .filter((edge) => allowed.has(edge.agentId))
            .map((edge) => (!edge.else || allowed.has(edge.else) ? edge : Struct.omit(edge, ["else"]))),
      }),
    ),
  }
}

export interface Handoff {
  readonly from: string
  readonly to: string
}

export interface History {
  readonly handoffs: ReadonlyArray<Handoff>
  readonly runs: ReadonlyArray<string>
}

export type Next =
  | {
      readonly _tag: "assign"
      readonly agentId: string | null
      readonly start: Factory.StartMode | undefined
      readonly note?: string
    }
  | { readonly _tag: "review"; readonly reason: string }
  | { readonly _tag: "refuse"; readonly message: string }
  | { readonly _tag: "conflict"; readonly message: string }

export const isGoverned = (factory: Factory.Info, agentId: string) =>
  factory.agents.some((entry) => entry.agentId === agentId && Boolean(entry.to))

export const choices = (factory: Factory.Info, from: string, history: History) => {
  const entry = factory.agents.find((candidate) => candidate.agentId === from)
  if (!entry?.to) return
  const governed = history.handoffs.filter((handoff) => isGoverned(factory, handoff.from))
  return {
    to: entry.to,
    used: (to: string) => governed.filter((handoff) => handoff.from === from && handoff.to === to).length,
    handoffs: { used: governed.length, max: factory.maxHandoffs },
  }
}

export const runs = (factory: Factory.Info, agentId: string, history: History) => {
  const max = factory.agents.find((entry) => entry.agentId === agentId)?.maxRuns
  if (!max) return
  return { used: history.runs.filter((run) => run === agentId).length, max }
}

export const next = (
  factory: Factory.Info,
  input: {
    readonly from: string
    readonly holder: string | null
    readonly to: string | null
    readonly start?: Factory.StartMode | undefined
    readonly history: History
    readonly names: ReadonlyMap<string, string>
  },
): Next => {
  const name = (agentId: string) => input.names.get(agentId) ?? agentId
  const target = (agentId: string, start: Factory.StartMode | undefined, note?: string): Next => {
    const limit = runs(factory, agentId, input.history)
    if (limit && limit.used >= limit.max)
      return { _tag: "review", reason: `${name(agentId)} ran ${limit.used} of ${limit.max} times.` }
    return { _tag: "assign", agentId, start, ...(note && { note }) }
  }
  const options = choices(factory, input.from, input.history)
  if (!options) return input.to ? target(input.to, input.start) : { _tag: "assign", agentId: null, start: undefined }
  if (input.from !== input.holder) return { _tag: "conflict", message: "Only the task’s agent can hand it off." }
  const edge = options.to.find((candidate) => candidate.agentId === input.to)
  if (!edge)
    return {
      _tag: "refuse",
      message:
        options.to.length === 0
          ? `${name(input.from)} can only request human review.`
          : `${name(input.from)} can hand off only to ${options.to.map((candidate) => name(candidate.agentId)).join(", ")}.`,
    }
  if (options.handoffs.used >= options.handoffs.max)
    return {
      _tag: "review",
      reason: `The task was handed off ${options.handoffs.used} of ${options.handoffs.max} times.`,
    }
  const start = input.start ?? edge.start
  const used = options.used(edge.agentId)
  if (!edge.max || used < edge.max) return target(edge.agentId, start)
  const reason = `${name(input.from)} → ${name(edge.agentId)} used ${used} of ${edge.max}.`
  if (!edge.else) return { _tag: "review", reason }
  return target(edge.else, start, `${name(edge.else)} got the task instead of ${name(edge.agentId)}: ${reason}`)
}

export const read = Effect.fnUntraced(function* (transaction: Database.Transaction, spaceId: Space.ID) {
  const row = (yield* transaction
    .select({ factory: Database.Schema.space.factory, usable: AgentQueries.factoryOrder })
    .from(Database.Schema.space)
    .where(eq(Database.Schema.space.id, spaceId))).at(0)
  return row ? keep(row.factory, row.usable) : Factory.empty
})

export const agents = Effect.fnUntraced(function* (transaction: Database.Transaction, agentIds: ReadonlyArray<string>) {
  const ids = agentIds.filter(Schema.is(Agent.ID))
  const rows =
    ids.length > 0
      ? yield* transaction
          .select({
            id: Database.Schema.agent.id,
            name: Database.Schema.agent.name,
            description: Database.Schema.agent.description,
          })
          .from(Database.Schema.agent)
          .where(inArray(Database.Schema.agent.id, ids))
      : []
  return new Map<string, (typeof rows)[number]>(rows.map((agent) => [agent.id, agent]))
})

const decision = alias(Database.Schema.task_event, "decision")

// oxlint-disable-next-line ren/no-comments -- The limits count from the latest decision of a person: a review decision or a person's assign.
export const history = Effect.fnUntraced(function* (transaction: Database.Transaction, taskId: Task.ID) {
  const events = yield* transaction
    .select({
      kind: Database.Schema.task_event.kind,
      agentId: sql<string | null>`${Database.Schema.task_event.data} ->> 'agentId'`,
      from: sql<string | null>`${Database.Schema.task_event.data} ->> 'fromAgentId'`,
      to: sql<string | null>`${Database.Schema.task_event.data} ->> 'toAgentId'`,
      byAgent: sql<boolean>`${Database.Schema.task_event.actor_agent_id} is not null`,
    })
    .from(Database.Schema.task_event)
    .where(
      and(
        eq(Database.Schema.task_event.task_id, taskId),
        inArray(Database.Schema.task_event.kind, ["assigned", "started"]),
        sql`not exists (
          select 1 from ${Database.Schema.task_event} as ${decision}
          where ${decision.task_id} = ${taskId}
            and (${decision.kind} = 'reviewed' or (${decision.kind} = 'assigned' and ${decision.actor_agent_id} is null))
            and (${decision.created_at}, ${decision.id}) > (${Database.Schema.task_event.created_at}, ${Database.Schema.task_event.id})
        )`,
      ),
    )
  return {
    handoffs: events.flatMap((event) =>
      event.kind === "assigned" && event.byAgent && event.from && event.to && event.from !== event.to
        ? [{ from: event.from, to: event.to }]
        : [],
    ),
    runs: events.flatMap((event) => (event.kind === "started" && event.agentId ? [event.agentId] : [])),
  }
})

const isHandOff = (
  task: { readonly space_id: Space.ID; readonly agent_id: Agent.ID | null },
  input: Pick<Task.AssignInput, "agentId" | "spaceId">,
) =>
  !Predicate.isUndefined(input.agentId) &&
  input.agentId !== task.agent_id &&
  (!input.spaceId || input.spaceId === task.space_id)

// oxlint-disable-next-line ren/no-comments -- The factory limits a handoff by an agent within its space; a person's assign is always an override.
export const handOff = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  task: { readonly id: Task.ID; readonly space_id: Space.ID; readonly agent_id: Agent.ID | null },
  caller: Agent.ID | undefined,
  input: Pick<Task.AssignInput, "agentId" | "spaceId" | "start">,
) {
  if (!caller || !isHandOff(task, input))
    return { _tag: "assign" as const, agentId: input.agentId, start: undefined, note: undefined }
  const factory = yield* read(transaction, task.space_id)
  const named = yield* agents(transaction, [caller, ...factory.agents.map((entry) => entry.agentId)])
  const decided = next(factory, {
    from: caller,
    holder: task.agent_id,
    to: input.agentId ?? null,
    ...(input.start !== "none" && { start: input.start }),
    history: yield* history(transaction, task.id),
    names: new Map([...named.values()].map((agent) => [agent.id, agent.name])),
  })
  if (decided._tag === "conflict") return yield* new Primitive.Conflict({ message: decided.message })
  if (decided._tag === "refuse") return yield* new Primitive.Invalid({ message: decided.message, field: "agentId" })
  if (decided._tag === "review") return decided
  return {
    _tag: "assign" as const,
    agentId: Schema.decodeUnknownSync(Schema.NullOr(Agent.ID))(decided.agentId),
    start: decided.start,
    note: decided.note,
  }
})

export const requestReview = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  task: {
    readonly id: Task.ID
    readonly organization_id: Auth.OrganizationID
    readonly human_review: boolean
    readonly human_review_reason: string | null
  },
  reason: string,
) {
  if (task.human_review && task.human_review_reason === reason) return
  yield* transaction
    .update(Database.Schema.task)
    .set({ human_review: true, human_review_reason: reason, updated_at: sql`now()` })
    .where(eq(Database.Schema.task.id, task.id))
  yield* TaskTrail.record(transaction, { id: task.id, organizationId: task.organization_id }, null, [
    { _tag: "review_requested", reason },
  ])
})
