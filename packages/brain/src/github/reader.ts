export * as GitHubReader from "./reader.js"

import { Credential } from "@ren/schema/credential"
import { Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"

export interface Hosts {
  readonly host: string
  readonly git: string
  readonly api: string
  readonly raw: string
}

const trimmed = (url: string) => url.replace(/\/$/u, "")

// oxlint-disable-next-line ren/no-comments -- Ren sends GITHUB_URL and GITHUB_API_URL in each pull. Without them the brain reads github.com.
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

export class Failed extends Schema.TaggedError<Failed>()("GitHubReader.Failed", { message: Schema.String }) {}

// oxlint-disable-next-line ren/no-comments -- R9: anonymous is a read without Authorization; placeholder is a read with ren:GITHUB, which the egress replaces with the token of the space.
export type Access = "anonymous" | "placeholder"

export interface Repository {
  readonly owner: string
  readonly repo: string
}

export interface Lookup {
  readonly hosts: Hosts
  readonly repository: Repository
  readonly commit: string
  readonly access: Access
}

export interface Archive {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export interface Interface {
  readonly lookup: (url: string, ref?: string) => Effect.Effect<Lookup, Failed>
  readonly read: (lookup: Lookup, path: string) => Effect.Effect<Option.Option<string>, Failed>
  readonly archive: (lookup: Lookup) => Archive
}

export const commitPattern = /^[0-9a-f]{40}$/u

const placeholder = Credential.placeholder("GITHUB")

const bearer = (access: Access): Readonly<Record<string, string>> =>
  access === "placeholder" ? { authorization: `Bearer ${placeholder}` } : {}

// oxlint-disable-next-line ren/no-comments -- Git's smart-HTTP ref advertisement: pkt-lines of "<sha> <ref>", the first one followed by NUL and capabilities.
const advertised = (body: string) => {
  const refs = new Map<string, string>()
  let offset = 0
  while (offset + 4 <= body.length) {
    const length = Number.parseInt(body.slice(offset, offset + 4), 16)
    if (Number.isNaN(length)) break
    const line =
      length === 0
        ? ""
        : (body
            .slice(offset + 4, offset + length)
            .split("\0")
            .at(0) ?? "")
    const sha = line.slice(0, 40)
    if (commitPattern.test(sha)) refs.set(line.slice(41).trim(), sha)
    offset += Math.max(length, 4)
  }
  return refs
}

const repositoryOf = (host: string, url: string): Repository | undefined => {
  const parsed = URL.parse(url)
  const parts = parsed?.pathname.split("/").filter(Boolean) ?? []
  const owner = parts.at(0)
  const repo = parts.at(1)?.replace(/\.git$/u, "")
  return parsed?.hostname === host && parts.length === 2 && owner && repo ? { owner, repo } : undefined
}

const commitOf = (refs: ReadonlyMap<string, string>, ref: string | undefined) => {
  if (!ref) return refs.get("HEAD")
  if (commitPattern.test(ref)) return ref
  return (
    refs.get(ref) ?? refs.get(`refs/heads/${ref}`) ?? refs.get(`refs/tags/${ref}^{}`) ?? refs.get(`refs/tags/${ref}`)
  )
}

// oxlint-disable-next-line ren/no-comments -- R11: each answer to the placeholder has one cause, except a repository that does not exist, which GitHub answers as a private one.
const causeOf = (response: HttpClientResponse.HttpClientResponse, name: string, url: string) => {
  const egress = response.headers["x-ren-egress"]
  if (response.status === 403 && egress === "credential_missing")
    return `this space has no GitHub credential: install the GitHub App or sign in with GitHub, or ${name} does not exist`
  if (response.status === 403 && egress) return `the egress refused the read of ${name}: ${egress}`
  if (response.status === 401)
    return `this runtime has no egress, so Ren cannot read private repositories here, or ${name} does not exist`
  if (response.status === 404)
    return `the GitHub App cannot read ${name}: add the repository to the installation, or ${name} does not exist`
  return `GitHub answered ${response.status} for ${url}`
}

export const make = Effect.fnUntraced(function* (hosts: Effect.Effect<Hosts>) {
  const http = yield* HttpClient.HttpClient
  const get = (url: string, request: string, headers: Readonly<Record<string, string>>) =>
    http
      .execute(HttpClientRequest.get(request).pipe(HttpClientRequest.setHeaders(headers)))
      .pipe(Effect.mapError((error) => new Failed({ message: `Could not read ${url} from GitHub: ${error.message}` })))
  const text = (response: HttpClientResponse.HttpClientResponse) =>
    response.text.pipe(Effect.mapError((error) => new Failed({ message: error.message })))
  return {
    lookup: Effect.fn("GitHubReader.lookup")(function* (url: string, ref?: string) {
      const found = yield* hosts
      const repository = repositoryOf(found.host, url)
      if (!repository) return yield* new Failed({ message: `Ren reads only repositories on ${found.host}, not ${url}` })
      const name = `${repository.owner}/${repository.repo}`
      const refs = `${found.git}/${name}.git/info/refs?service=git-upload-pack`
      const first = yield* get(url, refs, {})
      const isRefused = first.status === 401 || first.status === 404
      const answered = isRefused
        ? yield* get(url, refs, { authorization: `Basic ${btoa(`x-access-token:${placeholder}`)}` })
        : first
      if (answered.status !== 200) return yield* new Failed({ message: causeOf(answered, name, url) })
      const commit = commitOf(advertised(yield* text(answered)), ref)
      if (!commit) return yield* new Failed({ message: `The ref ${ref ?? "HEAD"} is not in ${url}` })
      return {
        hosts: found,
        repository,
        commit,
        access: isRefused ? ("placeholder" as const) : ("anonymous" as const),
      }
    }),
    read: Effect.fn("GitHubReader.read")(function* (lookup: Lookup, path: string) {
      const repository = `${lookup.repository.owner}/${lookup.repository.repo}`
      const url = `${lookup.hosts.raw}/${repository}/${lookup.commit}/${path}`
      const response = yield* get(url, url, bearer(lookup.access))
      if (response.status === 404) return Option.none()
      if (response.status !== 200)
        return yield* new Failed({ message: `GitHub answered ${response.status} for ${repository}/${path}` })
      return Option.some(yield* text(response))
    }),
    archive: (lookup) => ({
      url: `${lookup.hosts.api}/repos/${lookup.repository.owner}/${lookup.repository.repo}/tarball/${lookup.commit}`,
      headers: bearer(lookup.access),
    }),
  } satisfies Interface
})
