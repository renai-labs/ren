export * as GitHubHost from "./github.js"

import { GitHost } from "@ren/schema/git-host"
import { Effect, Option } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { GitHosts } from "./hosts.js"
import { LsRefs } from "./ls-refs.js"

export interface Hosts {
  readonly host: string
  readonly git: string
  readonly api: string
  readonly raw: string
}

const trimmed = (url: string) => url.replace(/\/$/u, "")

// oxlint-disable-next-line ren/no-comments -- R31, R62: Ren sends GITHUB_URL and GITHUB_API_URL in each pull. Without them the brain reads github.com.
export const hostsOf = (variables: Readonly<Record<string, string>>): Hosts => {
  const git = trimmed(variables.GITHUB_URL ?? "https://github.com")
  const host = URL.parse(git)?.hostname ?? "github.com"
  return {
    host,
    git,
    api: trimmed(variables.GITHUB_API_URL ?? (host === "github.com" ? "https://api.github.com" : `${git}/api/v3`)),
    raw: host === "github.com" ? "https://raw.githubusercontent.com" : `${git}/raw`,
  }
}

const placeholder = GitHost.placeholder("github")

const bearer = (access: LsRefs.Access): Readonly<Record<string, string>> =>
  access === "placeholder" ? { authorization: `Bearer ${placeholder}` } : {}

// oxlint-disable-next-line ren/no-comments -- R11: each answer to the placeholder has one reason, except a repository that does not exist, which GitHub answers as a private one.
const reasonOf = (response: HttpClientResponse.HttpClientResponse, name: string, url: string): GitHost.Unavailable => {
  const egress = response.headers["x-ren-egress"]
  if (response.status === 403 && egress === "credential_missing") return { reason: "no_credential", name }
  if (response.status === 403 && egress) return { reason: "egress_refused", name, detail: egress }
  if (response.status === 401) return { reason: "no_egress", name }
  if (response.status === 404) return { reason: "no_access", name }
  return { reason: "answered", name: url, detail: String(response.status) }
}

export const make = Effect.fnUntraced(function* (hosts: Effect.Effect<Hosts>) {
  const http = yield* HttpClient.HttpClient
  const send = (name: string) => (request: HttpClientRequest.HttpClientRequest) =>
    http
      .execute(request)
      .pipe(Effect.mapError((error) => GitHosts.failed({ reason: "unreachable", name, detail: error.message })))
  const bytes = (response: HttpClientResponse.HttpClientResponse, name: string) =>
    response.arrayBuffer.pipe(
      Effect.map((buffer) => new Uint8Array(buffer)),
      Effect.mapError((error) => GitHosts.failed({ reason: "unreachable", name, detail: error.message })),
    )
  return {
    kind: "github",
    name: Effect.map(hosts, (found) => found.host),
    repositoryOf: (url) =>
      Effect.map(hosts, (found) => {
        const parsed = URL.parse(url)
        const path = parsed?.pathname.split("/").filter(Boolean) ?? []
        const owner = path.at(0)
        const repo = path.at(1)?.replace(/\.git$/u, "")
        return parsed?.hostname === found.host && path.length === 2 && owner && repo
          ? Option.some({ kind: "github" as const, host: found.host, path: [owner, repo] })
          : Option.none()
      }),
    lookup: (repository, url, ref) =>
      Effect.gen(function* () {
        const found = yield* hosts
        const name = GitHosts.nameOf(repository)
        const answered = yield* LsRefs.request(send(url), {
          url: `${found.git}/${name}.git/git-upload-pack`,
          ref,
          authorization: `Basic ${btoa(`x-access-token:${placeholder}`)}`,
        })
        if (answered.response.status !== 200) return yield* GitHosts.failed(reasonOf(answered.response, name, url))
        const commit = LsRefs.commitOf(yield* bytes(answered.response, url), ref)
        if (!commit) return yield* GitHosts.failed({ reason: "missing_ref", name: url, detail: ref ?? "HEAD" })
        return {
          repository,
          commit,
          access: answered.access,
          archive: { url: `${found.api}/repos/${name}/tarball/${commit}`, headers: bearer(answered.access) },
        }
      }).pipe(GitHosts.within(url), Effect.withSpan("GitHubHost.lookup")),
    read: (lookup, file) => {
      const name = `https://${lookup.repository.host}/${GitHosts.nameOf(lookup.repository)}/${file}`
      return Effect.gen(function* () {
        const found = yield* hosts
        const url = `${found.raw}/${GitHosts.nameOf(lookup.repository)}/${lookup.commit}/${file}`
        const response = yield* send(url)(
          HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(bearer(lookup.access))),
        )
        if (response.status === 404) return Option.none()
        if (response.status !== 200)
          return yield* GitHosts.failed({
            reason: "answered",
            name: `${GitHosts.nameOf(lookup.repository)}/${file}`,
            detail: String(response.status),
          })
        return Option.some(new TextDecoder().decode(yield* bytes(response, url)))
      }).pipe(GitHosts.within(name), Effect.withSpan("GitHubHost.read"))
    },
  } satisfies GitHosts.Host
})
