export * as PullRequest from "./pull-request.js"

import type { Auth } from "@ren/schema/auth"
import type { PullRequest } from "@ren/schema/pull-request"
import { TaskLink } from "@ren/schema/task-link"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { GitHubApp } from "./github-app.js"

export const Pull = Schema.Struct({
  title: Schema.String,
  state: Schema.String,
  draft: Schema.optionalKey(Schema.Boolean),
  merged: Schema.optionalKey(Schema.Boolean),
  head: Schema.Struct({ ref: Schema.String }),
  base: Schema.Struct({ ref: Schema.String }),
})

export const stateOf = (pull: typeof Pull.Type): PullRequest.State => {
  if (pull.merged) return "merged"
  if (pull.state !== "open") return "closed"
  return pull.draft ? "draft" : "open"
}

const concurrency = 4

export interface Interface {
  readonly read: (
    organizationId: Auth.OrganizationID,
    urls: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<PullRequest.Info>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/PullRequest") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const github = yield* GitHubApp.Service
    return Service.of({
      read: Effect.fn("PullRequest.read")(function* (organizationId: Auth.OrganizationID, urls: ReadonlyArray<string>) {
        const pulls = urls.flatMap((url) => {
          const ref = TaskLink.classify(url)
          const split = ref.key.lastIndexOf("#")
          return ref.kind === "github_pr"
            ? [{ url, repository: ref.key.slice(0, split), number: Number(ref.key.slice(split + 1)) }]
            : []
        })
        if (pulls.length === 0) return []
        const installed = yield* github.installationOf(organizationId)
        return yield* Effect.forEach(
          pulls,
          (pull): Effect.Effect<PullRequest.Info> => {
            const unknown = { url: pull.url, number: pull.number, title: null, state: null }
            if (Option.isNone(installed)) return Effect.succeed(unknown)
            const repository = pull.repository.split("/").map(encodeURIComponent).join("/")
            return installed.value.client
              .read(installed.value.installation, `/repos/${repository}/pulls/${pull.number}`, Pull)
              .pipe(
                Effect.map((found) => ({ ...unknown, title: found.title, state: stateOf(found) })),
                Effect.catchTag("GitHubApp.Failed", (error) =>
                  Effect.logDebug(`GitHub did not show ${pull.url}`, error).pipe(Effect.as(unknown)),
                ),
              )
          },
          { concurrency },
        )
      }),
    })
  }),
)
