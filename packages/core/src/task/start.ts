export * as TaskStart from "./start.js"

import { Database } from "@ren/db/database"
import { Factory } from "@ren/schema/factory"
import { Task } from "@ren/schema/task"
import { and, desc, eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { AgentQueries } from "../agent/queries.js"
import { Primitive } from "../primitive.js"
import { TaskFactory } from "./factory.js"
import { TaskQueries } from "./queries.js"

export interface Review {
  readonly decision: Task.Decision
  readonly comment: string | null
  readonly descriptionChanged: boolean
}

const note =
  "Read the task and its trail with `task_get`, then work your part. When your part is complete, hand off with " +
  "`task_assign`. When a person must decide, use `task_review` and end your turn. Never set the status to `done` " +
  "or `dismissed`, and do not create a second task for the same work."

interface Described {
  readonly name: string
  readonly description: string | null
}

const describe = (agent: Described) => `${agent.name}${agent.description ? ` — ${agent.description}` : ""}`

const prompt = (input: {
  readonly task: TaskQueries.Row
  readonly handoff: string | null
  readonly factory: ReadonlyArray<string>
  readonly review: Review | undefined
}) => {
  const review = input.review && [
    `Review: ${input.review.decision}.`,
    ...(input.review.comment ? [`Comment: ${input.review.comment}`] : []),
    ...(input.review.descriptionChanged ? ["The description changed after the review was requested."] : []),
  ]
  const sections = [
    [`${input.task.prefix}-${input.task.task.number}: ${input.task.task.title}`],
    input.task.task.description ? [input.task.task.description] : [],
    input.handoff ? [`Handoff note: ${input.handoff}`] : [],
    review ?? [],
    input.factory,
  ].filter((section) => section.length > 0)
  return [
    `<task_assignment task_id=${JSON.stringify(input.task.task.id)} note=${JSON.stringify(note)}>`,
    sections.map((section) => section.join("\n")).join("\n\n"),
    "</task_assignment>",
  ].join("\n")
}

// oxlint-disable-next-line ren/no-comments -- A governed agent sees its handoff choices and limits; any other agent sees the factory's order.
const factorySection = (
  factory: Factory.Info,
  agentId: string,
  history: TaskFactory.History,
  agents: ReadonlyMap<string, Described>,
) => {
  const name = (id: string) => agents.get(id)?.name ?? id
  const choices = TaskFactory.choices(factory, agentId, history)
  if (!choices) {
    const order = factory.agents.flatMap((entry) => agents.get(entry.agentId) ?? [])
    return order.length > 0 ? ["Factory:", ...order.map((agent, index) => `${index + 1}. ${describe(agent)}`)] : []
  }
  const runs = TaskFactory.runs(factory, agentId, history)
  const fallback = (edge: (typeof choices.to)[number]) =>
    edge.else ? `the task goes to ${name(edge.else)}` : "the task goes to human review"
  return [
    ...(choices.to.length > 0
      ? [
          "Hand off with task_assign to one of:",
          ...choices.to.map((edge) => {
            const agent = agents.get(edge.agentId) ?? { name: edge.agentId, description: null }
            const limit = edge.max ? ` (used ${choices.used(edge.agentId)} of ${edge.max}; then ${fallback(edge)})` : ""
            return `- ${describe(agent)}${limit}`
          }),
        ]
      : []),
    [
      ...(runs ? [`Run ${runs.used + 1} of ${runs.max} for ${name(agentId)}.`] : []),
      `Handoffs: ${choices.handoffs.used} of ${choices.handoffs.max}.`,
    ].join(" "),
    "If no agent fits, or a person must decide, use task_review.",
  ]
}

export const plan = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  row: TaskQueries.Row,
  input: {
    readonly mode: Task.StartMode
    readonly review: Review | undefined
    readonly factory: Factory.Info
    readonly history: TaskFactory.History
  },
) {
  if (!Task.actionable.includes(row.task.status))
    return yield* new Primitive.Conflict({ message: "Only a task that is todo or in progress can start." })
  if (!row.task.agent_id)
    return yield* new Primitive.Conflict({ message: "Give the task an agent before you start it." })
  const agent = (yield* transaction
    .select({ id: Database.Schema.agent.id, organizationId: Database.Schema.agent.organization_id })
    .from(Database.Schema.agent)
    .where(
      and(
        eq(Database.Schema.agent.id, row.task.agent_id),
        AgentQueries.isUsableIn(row.task.space_id, row.task.organization_id),
      ),
    )
    .for("share")).at(0)
  if (!agent)
    return yield* new Primitive.Conflict({
      message: "The task’s agent is archived or no longer available in its space.",
    })
  const session =
    input.mode === "continue" ? (yield* TaskQueries.latestSessions(transaction, [row.task.id])).at(0) : undefined
  const agents = yield* TaskFactory.agents(
    transaction,
    input.factory.agents.map((entry) => entry.agentId),
  )
  const handoff = (yield* transaction
    .select({ note: sql<string | null>`${Database.Schema.task_event.data} ->> 'note'` })
    .from(Database.Schema.task_event)
    .where(
      and(
        eq(Database.Schema.task_event.task_id, row.task.id),
        eq(Database.Schema.task_event.kind, "assigned"),
        sql`${Database.Schema.task_event.data} ->> 'toAgentId' = ${agent.id}`,
        sql`(${Database.Schema.task_event.data} ->> 'fromAgentId' is distinct from ${agent.id}
          or ${Database.Schema.task_event.data} ->> 'note' is not null)`,
      ),
    )
    .orderBy(desc(Database.Schema.task_event.created_at), desc(Database.Schema.task_event.id))
    .limit(1)).at(0)?.note
  return {
    agentId: agent.id,
    isGlobal: !agent.organizationId,
    sessionId: session?.id,
    text: prompt({
      task: row,
      handoff: handoff ?? null,
      factory: factorySection(input.factory, agent.id, input.history, agents),
      review: input.review,
    }),
  }
})
