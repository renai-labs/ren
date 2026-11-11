export * as GitSources from "./git-sources.js"

import { GitHubHost } from "@ren/brain/git/github"
import { GitHosts } from "@ren/brain/git/hosts"
import { Repositories } from "@ren/brain/reference/repositories"
import { SkillCache } from "@ren/brain/skill/cache"
import { SkillSource } from "@ren/brain/skill/source"
import { Context, type Duration, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { CredentialEnv } from "./credential-env.js"

export interface Interface {
  readonly hosts: GitHosts.Interface
  readonly repositories: Repositories.Interface
  readonly skills: { readonly source: SkillSource.Interface; readonly cache: SkillCache.Interface }
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/GitSources") {}

export interface Options {
  readonly github?: Effect.Effect<GitHubHost.Hosts>
  readonly references?: { readonly refresh: Duration.Input; readonly retry: Duration.Input }
  readonly skills?: { readonly refresh: Duration.Input }
}

// oxlint-disable-next-line ren/no-comments -- R55: the git hosts and the caches of references and skills, one set for the whole cell and every harness.
export const make = Effect.fnUntraced(function* (options: Options = {}) {
  const github = yield* GitHubHost.make(options.github ?? Effect.succeed(GitHubHost.hostsOf({}))).pipe(
    Effect.provide(FetchHttpClient.layer),
  )
  const hosts = GitHosts.make([github])
  const source = SkillSource.make(hosts)
  return {
    hosts,
    repositories: yield* Repositories.make(hosts, options.references),
    skills: { source, cache: yield* SkillCache.make(source, { refresh: options.skills?.refresh ?? "5 minutes" }) },
  } satisfies Interface
})

// oxlint-disable-next-line ren/no-comments -- R62: the GitHub hosts come from GITHUB_URL and GITHUB_API_URL of the latest pull.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* Effect.serviceOption(CredentialEnv.Service)
    return yield* make({
      github: Option.match(env, {
        onNone: () => Effect.succeed(GitHubHost.hostsOf({})),
        onSome: (found) => Effect.map(found.current, (current) => GitHubHost.hostsOf(current.variables)),
      }),
    })
  }),
)
