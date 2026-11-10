export * as GitHubTaskCard from "./github-task-card.js"

import { Database } from "@ren/db/database"
import type { Task } from "@ren/schema/task"
import { and, asc, eq, inArray } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { GitHubApp } from "./github-app.js"
import { TaskCardSync } from "./task-card-sync.js"
import { TaskQueries } from "./task/queries.js"

export interface Interface {
  readonly refresh: (taskId: Task.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/GitHubTaskCard") {}

export const layerNone = Layer.succeed(Service, Service.of({ refresh: () => Effect.void }))

const marker = (taskId: Task.ID) => `<!-- ren:task ${taskId} -->`

const statusText: Readonly<Record<Task.Status, string>> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
}

const commentsPerPage = 100

const Comments = Schema.Array(
  Schema.Struct({
    id: Schema.Number,
    body: Schema.optionalKey(Schema.String),
    user: Schema.NullOr(Schema.Struct({ id: Schema.Number })),
  }),
)

const escaped = (text: string) => text.replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const bodyOf = (
  app: string,
  card: {
    readonly id: Task.ID
    readonly identifier: string
    readonly title: string
    readonly status: Task.Status
    readonly ready: boolean
    readonly agent: string | null
    readonly phases: ReadonlyArray<{ readonly agent: string | null; readonly sessionId: string }>
  },
) =>
  [
    marker(card.id),
    `**[${card.identifier}](${app}/tasks/${card.identifier})** ${escaped(card.title)}`,
    `**Status:** ${card.ready ? "Ready" : statusText[card.status]} · **Agent:** ${card.agent ?? "none"}`,
    ...(card.phases.length > 0
      ? [
          [
            "| Phase | Session |",
            "| --- | --- |",
            ...card.phases.map(
              (phase) => `| ${phase.agent ?? "—"} | [${phase.sessionId}](${app}/sessions/${phase.sessionId}) |`,
            ),
          ].join("\n"),
        ]
      : []),
  ].join("\n\n")

// oxlint-disable-next-line ren/no-comments -- The caller does not wait for GitHub. A failure leaves the comment stale until the next change.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const github = yield* GitHubApp.Service
    const app = (yield* Config.String("APP_URL").pipe(Effect.orDie)).replace(/\/$/u, "")
    const background = TaskCardSync.make(yield* Effect.scope, "GitHub cards")
    const task = Database.Schema.task
    const link = Database.Schema.task_link
    const session = Database.Schema.task_session
    const agent = Database.Schema.agent

    const find = (
      installation: string,
      client: GitHubApp.Client,
      path: string,
      taskId: Task.ID,
      page: number,
    ): Effect.Effect<Option.Option<{ readonly id: number; readonly body?: string }>, GitHubApp.Failed> =>
      client.read(installation, `${path}?per_page=${commentsPerPage}&page=${page}`, Comments).pipe(
        Effect.flatMap((comments) => {
          const found = comments.find(
            (comment) =>
              String(comment.user?.id) === client.settings.botUserId && comment.body?.includes(marker(taskId)),
          )
          if (found) return Effect.succeedSome(found)
          return comments.length < commentsPerPage
            ? Effect.succeedNone
            : find(installation, client, path, taskId, page + 1)
        }),
      )

    const sync = Effect.fnUntraced(function* (taskId: Task.ID) {
      const links = yield* database.db
        .select({ key: link.key })
        .from(link)
        .where(and(eq(link.task_id, taskId), inArray(link.kind, ["github_pr", "github_issue"])))
        .orderBy(asc(link.created_at))
      if (links.length === 0) return
      const row = (yield* database.db
        .select({
          organizationId: task.organization_id,
          number: task.number,
          title: task.title,
          status: task.status,
          ready: TaskQueries.isReady(task),
          prefix: Database.Schema.task_sequence.prefix,
          agent: agent.name,
        })
        .from(task)
        .innerJoin(
          Database.Schema.task_sequence,
          eq(Database.Schema.task_sequence.organization_id, task.organization_id),
        )
        .leftJoin(agent, eq(agent.id, task.agent_id))
        .where(eq(task.id, taskId))).at(0)
      if (!row) return
      const installed = yield* github.installationOf(row.organizationId)
      if (Option.isNone(installed))
        return yield* Effect.logInfo(`No GitHub install of ${row.organizationId} shows the card of ${taskId}`)
      const phases = yield* database.db
        .select({ sessionId: session.session_id, agent: agent.name })
        .from(session)
        .leftJoin(agent, eq(agent.id, session.agent_id))
        .where(eq(session.task_id, taskId))
        .orderBy(asc(session.created_at), asc(session.session_id))
      const body = bodyOf(app, {
        id: taskId,
        identifier: `${row.prefix}-${row.number}`,
        title: row.title,
        status: row.status,
        ready: row.ready,
        agent: row.agent,
        phases,
      })
      const client = installed.value.client
      const installation = installed.value.installation
      yield* Effect.forEach(
        links,
        (linked) => {
          const repository = linked.key.slice(0, linked.key.lastIndexOf("#"))
          const number = linked.key.slice(linked.key.lastIndexOf("#") + 1)
          const path = `/repos/${repository.split("/").map(encodeURIComponent).join("/")}/issues`
          return find(installation, client, `${path}/${number}/comments`, taskId, 1).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => client.post(installation, `${path}/${number}/comments`, { body }),
                onSome: (found) =>
                  found.body === body
                    ? Effect.void
                    : client.patch(installation, `${path}/comments/${found.id}`, { body }),
              }),
            ),
            Effect.catchTag("GitHubApp.Failed", (error) =>
              Effect.logWarning(`The GitHub card of ${taskId} on ${linked.key} was not written`, error),
            ),
          )
        },
        { discard: true },
      )
    })

    return Service.of({
      refresh: (taskId) => background(taskId, sync(taskId).pipe(Effect.withSpan("GitHubTaskCard.refresh"))),
    })
  }),
)
