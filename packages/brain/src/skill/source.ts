export * as SkillSource from "./source.js"

import type { Skill } from "@ren/schema/skill"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient } from "effect/http"

export interface Hosts {
  readonly git: string
  readonly raw: string
  readonly archive: string
}

export const github: Hosts = {
  git: "https://github.com",
  raw: "https://raw.githubusercontent.com",
  archive: "https://codeload.github.com",
}

export class Failed extends Schema.TaggedError<Failed>()("SkillSource.Failed", { message: Schema.String }) {}

export type Pointer = Skill.Upstream["upstream"]

export interface Resolved {
  readonly commit: string
  readonly document: string
}

export interface Interface {
  readonly resolve: (pointer: Pointer) => Effect.Effect<Resolved, Failed>
  readonly archive: (pointer: Pointer, commit: string) => Effect.Effect<string, Failed>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/SkillSource") {}

const commitPattern = /^[0-9a-f]{40}$/u

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

export const make = Effect.fnUntraced(function* (hosts: Hosts = github) {
  const http = yield* HttpClient.HttpClient
  const repositoryOf = (url: string) => {
    const parsed = URL.parse(url)
    const parts = parsed?.pathname.split("/").filter(Boolean) ?? []
    const owner = parts.at(0)
    const repo = parts.at(1)?.replace(/\.git$/u, "")
    return parsed?.hostname === "github.com" && parts.length === 2 && owner && repo
      ? Effect.succeed({ owner, repo })
      : Effect.fail(new Failed({ message: `Ren reads skills only from GitHub repositories, not ${url}` }))
  }
  const get = (pointer: Pointer, url: string) =>
    http
      .get(url)
      .pipe(
        Effect.mapError(
          (error) => new Failed({ message: `Could not read ${pointer.url} from GitHub: ${error.message}` }),
        ),
      )
  const unexpected = (pointer: Pointer, status: number) =>
    new Failed({ message: `GitHub answered ${status} for ${pointer.url}` })
  return Service.of({
    resolve: Effect.fn("SkillSource.resolve")(function* (pointer: Pointer) {
      const repository = yield* repositoryOf(pointer.url)
      const ref = pointer.ref
      const commit =
        ref && commitPattern.test(ref)
          ? ref
          : yield* get(
              pointer,
              `${hosts.git}/${repository.owner}/${repository.repo}.git/info/refs?service=git-upload-pack`,
            ).pipe(
              Effect.flatMap((response) =>
                response.status === 200
                  ? response.text.pipe(
                      Effect.mapError((error) => new Failed({ message: error.message })),
                      Effect.map(advertised),
                    )
                  : Effect.fail(unexpected(pointer, response.status)),
              ),
              Effect.flatMap((refs) => {
                const found = ref
                  ? (refs.get(ref) ??
                    refs.get(`refs/heads/${ref}`) ??
                    refs.get(`refs/tags/${ref}^{}`) ??
                    refs.get(`refs/tags/${ref}`))
                  : refs.get("HEAD")
                return found
                  ? Effect.succeed(found)
                  : Effect.fail(new Failed({ message: `The ref ${ref ?? "HEAD"} is not in ${pointer.url}` }))
              }),
            )
      const file = pointer.path === "." ? "SKILL.md" : `${pointer.path}/SKILL.md`
      const response = yield* get(pointer, `${hosts.raw}/${repository.owner}/${repository.repo}/${commit}/${file}`)
      if (response.status === 404) return yield* new Failed({ message: `${pointer.url} has no ${file} at ${commit}` })
      if (response.status !== 200) return yield* unexpected(pointer, response.status)
      const document = yield* response.text.pipe(Effect.mapError((error) => new Failed({ message: error.message })))
      return { commit, document }
    }),
    archive: (pointer, commit) =>
      Effect.map(
        repositoryOf(pointer.url),
        (repository) => `${hosts.archive}/${repository.owner}/${repository.repo}/tar.gz/${commit}`,
      ),
  })
})

export const layer = (hosts: Hosts = github) => Layer.effect(Service, make(hosts))
