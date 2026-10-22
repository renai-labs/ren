export * as TaskStart from "./start.js"

import { Database } from "@ren/db/database"
import { Task } from "@ren/schema/task"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"
import { AgentQueries } from "../agent/queries.js"
import { Primitive } from "../primitive.js"
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

const prompt = (input: {
  readonly task: TaskQueries.Row
  readonly handoff: string | null
  readonly order: ReadonlyArray<{ readonly name: string; readonly description: string | null }>
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
    input.order.length > 0
      ? [
          "Factory order:",
          ...input.order.map(
            (agent, index) => `${index + 1}. ${agent.name}${agent.description ? ` — ${agent.description}` : ""}`,
          ),
        ]
      : [],
  ].filter((section) => section.length > 0)
  return [
    `<task_assignment task_id=${JSON.stringify(input.task.task.id)} note=${JSON.stringify(note)}>`,
    sections.map((section) => section.join("\n")).join("\n\n"),
    "</task_assignment>",
  ].join("\n")
}

export const plan = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  row: TaskQueries.Row,
  mode: Task.StartMode,
  review?: Review,
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
    mode === "continue" ? (yield* TaskQueries.latestSessions(transaction, [row.task.id])).at(0) : undefined
  const order =
    (yield* transaction
      .select({ order: AgentQueries.factoryOrder })
      .from(Database.Schema.space)
      .where(eq(Database.Schema.space.id, row.task.space_id))).at(0)?.order ?? []
  const agents = new Map(
    (order.length > 0
      ? yield* transaction
          .select({
            id: Database.Schema.agent.id,
            name: Database.Schema.agent.name,
            description: Database.Schema.agent.description,
          })
          .from(Database.Schema.agent)
          .where(inArray(Database.Schema.agent.id, order))
      : []
    ).map((found) => [found.id, found]),
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
      order: order.flatMap((id) => agents.get(id) ?? []),
      review,
    }),
  }
})
