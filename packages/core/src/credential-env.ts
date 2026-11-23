export * as CredentialEnv from "./credential-env.js"

import { Database } from "@ren/db/database"
import type { PullEnv } from "@ren/host-api/ren-host-api"
import type { Auth } from "@ren/schema/auth"
import type { Session } from "@ren/schema/session"
import type { Workload } from "@ren/schema/workload"
import { and, eq, inArray } from "drizzle-orm"
import { Array, Context, Effect, Layer, Option, Record } from "effect"
import { AppProfiles } from "./app/profiles.js"
import { Credentials } from "./credentials.js"
import { GitHubApp } from "./github-app.js"
import { PersonCredentials } from "./person-credentials.js"

export interface Interface {
  readonly of: (workload: Workload.Info) => Effect.Effect<PullEnv>
  // oxlint-disable-next-line ren/no-comments -- The `Co-authored-by` values of each chat's commits: the person who runs the chat, else the creator of a task it works on, then the GitHub App's bot. Empty without the GitHub App.
  readonly coAuthors: (
    organizationId: Auth.OrganizationID,
    sessionIds: ReadonlyArray<Session.ID>,
  ) => Effect.Effect<ReadonlyMap<Session.ID, ReadonlyArray<string>>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/CredentialEnv") {}

const none: PullEnv = { variables: {}, placeholders: {} }

export const layerNone = Layer.succeed(
  Service,
  Service.of({ of: () => Effect.succeed(none), coAuthors: () => Effect.succeed(new Map()) }),
)

// oxlint-disable-next-line ren/no-comments -- A name in the later env wins over the same name in the earlier one, in either list.
const merged = (earlier: PullEnv, later: PullEnv): PullEnv => ({
  variables: { ...Record.filter(earlier.variables, (_, name) => !(name in later.placeholders)), ...later.variables },
  placeholders: {
    ...Record.filter(earlier.placeholders, (_, name) => !(name in later.variables)),
    ...later.placeholders,
  },
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const credentials = yield* Credentials.Service
    const profiles = yield* AppProfiles.Service
    const github = yield* GitHubApp.Service
    const people = yield* PersonCredentials.Service
    return Service.of({
      of: Effect.fn("CredentialEnv.of")(function* (workload: Workload.Info) {
        const scope = yield* credentials.scopeOf(workload)
        if (Option.isNone(scope)) return none
        const reached = yield* profiles.reachable(scope.value)
        const organizationId = scope.value.organizationId
        const person = yield* Option.match(scope.value.person, {
          onNone: () => Effect.succeedNone,
          onSome: (userId) => people.account(organizationId, userId, GitHubApp.label),
        })
        const installed = Option.isSome(yield* github.installationOf(organizationId))
        return merged(
          Option.match(github.client, {
            onNone: () => none,
            onSome: (client) =>
              installed || Option.isSome(person) ? GitHubApp.variables(client.settings, person) : none,
          }),
          yield* credentials.environment(
            scope.value,
            reached.map((profile) => profile.id),
          ),
        )
      }),
      coAuthors: Effect.fn("CredentialEnv.coAuthors")(function* (
        organizationId: Auth.OrganizationID,
        sessionIds: ReadonlyArray<Session.ID>,
      ) {
        if (Option.isNone(github.client) || sessionIds.length === 0) return new Map<Session.ID, ReadonlyArray<string>>()
        const app = github.client.value.settings
        const sessions = Database.Schema.agent_session
        const links = Database.Schema.task_session
        const tasks = Database.Schema.task
        const rows = yield* database.db
          .select({ sessionId: sessions.id, runner: sessions.created_by, taskCreator: tasks.created_by_user_id })
          .from(sessions)
          .leftJoin(links, eq(links.session_id, sessions.id))
          .leftJoin(tasks, eq(tasks.id, links.task_id))
          .where(and(eq(sessions.organization_id, organizationId), inArray(sessions.id, [...sessionIds])))
          .orderBy(tasks.created_at)
          .pipe(Effect.orDie)
        const accounts = new Map(
          yield* Effect.forEach(
            Array.dedupe(rows.flatMap((row) => [row.runner, ...(row.taskCreator ? [row.taskCreator] : [])])),
            (userId) =>
              Effect.map(
                people.account(organizationId, userId, GitHubApp.label),
                (account) => [userId, account] as const,
              ),
            { concurrency: 8 },
          ),
        )
        const trailer = (person: Option.Option<PersonCredentials.Account>) => {
          const found = GitHubApp.identity(app, person)
          return `${found.name} <${found.email}>`
        }
        return new Map(
          sessionIds.map((sessionId) => {
            const own = rows.filter((row) => row.sessionId === sessionId)
            const person = Array.findFirst(
              Array.dedupe([...own.map((row) => row.runner), ...own.flatMap((row) => row.taskCreator ?? [])]),
              (userId) => accounts.get(userId) ?? Option.none(),
            )
            return [
              sessionId,
              [
                ...Option.toArray(Option.map(person, (account) => trailer(Option.some(account)))),
                trailer(Option.none()),
              ],
            ] as const
          }),
        )
      }),
    })
  }),
)
