export * as RepositoryHosts from "./repository-hosts.js"

import type { Auth } from "@ren/schema/auth"
import type { GitHost } from "@ren/schema/git-host"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient } from "effect/http"
import { GitHubApp } from "./github-app.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("RepositoryHosts.Unavailable", {
  message: Schema.String,
}) {}

// oxlint-disable-next-line ren/no-comments -- R58: one git host as Ren's server sees it. A second host (GitLab) is a new entry.
export interface Host {
  readonly kind: GitHost.Kind
  readonly host: string
  // oxlint-disable-next-line ren/no-comments -- R13: the reason that the org cannot read the repository, or none when it can or when the host does not answer.
  readonly check: (organizationId: Auth.OrganizationID, url: URL) => Effect.Effect<Option.Option<GitHost.Unavailable>>
  readonly list: (organizationId: Auth.OrganizationID) => Effect.Effect<GitHost.Listing, Unavailable>
}

export interface Interface {
  readonly hosts: ReadonlyArray<Host>
  readonly hostOf: (url: URL) => Option.Option<Host>
  readonly list: (organizationId: Auth.OrganizationID) => Effect.Effect<ReadonlyArray<GitHost.Listing>, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/RepositoryHosts") {}

export const make = (hosts: ReadonlyArray<Host>): Interface => ({
  hosts,
  hostOf: (url) => Option.fromUndefinedOr(hosts.find((host) => host.host === url.hostname)),
  list: (organizationId) => Effect.forEach(hosts, (host) => host.list(organizationId), { concurrency: "unbounded" }),
})

const Repository = Schema.Struct({
  full_name: Schema.String,
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  html_url: Schema.String,
})

const Repositories = Schema.Struct({ total_count: Schema.Number, repositories: Schema.Array(Repository) })

const answerWithin = "10 seconds"

// oxlint-disable-next-line ren/no-comments -- R13, R26: GitHub reads a repository with the org's installation, or with no token when the org has none. Only a 404 refuses it; a GitHub that does not answer does not block a save.
export const github = Effect.gen(function* () {
  const app = yield* GitHubApp.Service
  const http = yield* HttpClient.HttpClient
  const web = Option.match(app.client, { onNone: () => "https://github.com", onSome: (found) => found.settings.web })
  const api = Option.match(app.client, {
    onNone: () => "https://api.github.com",
    onSome: (found) => found.settings.api,
  })
  const host = new URL(web).hostname
  const pages = (
    installation: string,
    client: GitHubApp.Client,
    page: number,
    found: ReadonlyArray<GitHost.Repository>,
  ): Effect.Effect<ReadonlyArray<GitHost.Repository>, GitHubApp.Failed> =>
    client.read(installation, `/installation/repositories?per_page=100&page=${page}`, Repositories).pipe(
      Effect.flatMap((answer) => {
        const all = [
          ...found,
          ...answer.repositories.map((repository) => ({
            kind: "github" as const,
            url: repository.html_url,
            name: repository.full_name,
            ...(repository.description && { description: repository.description }),
          })),
        ]
        return answer.repositories.length < 100 || all.length >= answer.total_count
          ? Effect.succeed(all)
          : pages(installation, client, page + 1, all)
      }),
    )
  return {
    kind: "github",
    host,
    check: Effect.fn("RepositoryHosts.github.check")(function* (organizationId: Auth.OrganizationID, url: URL) {
      const path = url.pathname.split("/").filter(Boolean)
      const name = path.join("/").replace(/\.git$/u, "")
      if (path.length !== 2) return Option.some({ reason: "not_repository" as const, name: url.href, detail: host })
      const installation = yield* app.installationOf(organizationId)
      const status = yield* Option.match(installation, {
        onSome: (found) =>
          found.client.read(found.installation, `/repos/${name}`, Schema.Unknown).pipe(
            Effect.as(200),
            Effect.catch((error) => Effect.succeed(error.status ?? 0)),
          ),
        onNone: () =>
          http.get(`${api}/repos/${name}`).pipe(
            Effect.map((response) => response.status),
            Effect.orElseSucceed(() => 0),
          ),
      }).pipe(
        Effect.timeout(answerWithin),
        Effect.orElseSucceed(() => 0),
      )
      if (status === 404)
        return Option.some({
          reason: Option.isSome(installation) ? ("no_access" as const) : ("no_credential" as const),
          name,
        })
      if (status !== 200)
        yield* Effect.logWarning(
          `Saved the reference ${url.href} without a check: ${status === 0 ? "GitHub did not answer" : `GitHub answered ${status}`}`,
        )
      return Option.none()
    }),
    list: Effect.fn("RepositoryHosts.github.list")(function* (organizationId: Auth.OrganizationID) {
      const installation = yield* app.installationOf(organizationId)
      if (Option.isNone(installation)) return { kind: "github" as const, installed: false, repositories: [] }
      const repositories = yield* pages(installation.value.installation, installation.value.client, 1, []).pipe(
        Effect.mapError(
          (error) => new Unavailable({ message: `GitHub did not list the repositories: ${error.message}` }),
        ),
      )
      return { kind: "github" as const, installed: true, repositories }
    }),
  } satisfies Host
})

export const layer = Layer.effect(
  Service,
  Effect.map(github, (host) => Service.of(make([host]))),
)

export const layerNone = Layer.succeed(Service, Service.of(make([])))
